<?php
declare(strict_types=1);

namespace PhotoBook;

use GdImage;

/**
 * Carte statique (PNG) assemblée à partir de tuiles XYZ, avec tracé et repères numérotés.
 * Utilisée à l'identique pour l'aperçu de l'éditeur et pour le PDF.
 */
final class StaticMap
{
    private const TILE = 256;
    /** Au-delà de cette distance, un segment est considéré comme un vol : arc en pointillés. */
    private const FLIGHT_KM = 300;

    private int $zoom = 2;
    private float $originX = 0;
    private float $originY = 0;

    /**
     * @param int $width  largeur logique en pixels (1 px logique = 1/MAP_DPI de pouce)
     * @param int $scale  facteur de rendu (2 pour l'impression)
     * @param array $markers [['lat'=>, 'lon'=>, 'label'=>?string, 'number'=>?int]]
     * @param array $path    [[lat, lon], …] dans l'ordre chronologique
     */
    public function __construct(
        private int $width,
        private int $height,
        private array $markers,
        private array $path = [],
        private int $scale = 2,
        private int $maxZoom = 14,
        private array $dots = [],
    ) {
    }

    public function render(): GdImage
    {
        $this->fit();
        $s = $this->scale;
        $img = imagecreatetruecolor($this->width * $s, $this->height * $s);
        imagealphablending($img, true);
        imageantialias($img, true);
        imagefill($img, 0, 0, imagecolorallocate($img, 228, 236, 240));
        $this->drawTiles($img);
        $this->drawPath($img);
        foreach ($this->dots as $d) {
            [$x, $y] = $this->project($d[0], $d[1]);
            $this->disc($img, $x * $s, $y * $s, 4.5 * $s, [255, 255, 255], [214, 72, 52]);
        }
        foreach ($this->markers as $m) {
            $this->drawMarker($img, $m);
        }
        $this->drawAttribution($img);
        return $img;
    }

    // --- Projection Web Mercator -------------------------------------------------

    private static function worldX(float $lon, int $z): float
    {
        return self::TILE * (2 ** $z) * ($lon + 180) / 360;
    }

    private static function worldY(float $lat, int $z): float
    {
        $lat = max(-85.0, min(85.0, $lat));
        $r = deg2rad($lat);
        return self::TILE * (2 ** $z) * (1 - log(tan($r) + 1 / cos($r)) / M_PI) / 2;
    }

    /** Position en pixels logiques dans l'image. */
    private function project(float $lat, float $lon): array
    {
        return [self::worldX($lon, $this->zoom) - $this->originX, self::worldY($lat, $this->zoom) - $this->originY];
    }

    private function allPoints(): array
    {
        $pts = array_map(fn ($m) => [$m['lat'], $m['lon']], $this->markers);
        return array_merge($pts, $this->path, $this->dots);
    }

    /** Choisit le zoom le plus fort qui fait tenir tous les points avec une marge. */
    private function fit(): void
    {
        $pts = $this->allPoints();
        if (!$pts) {
            $pts = [[46.5, 2.5]];
        }
        $pad = (int) round(min($this->width, $this->height) * 0.12) + 24;
        $lats = array_column($pts, 0);
        $lons = array_column($pts, 1);
        $z = $this->maxZoom;
        for (; $z > 1; $z--) {
            $w = self::worldX(max($lons), $z) - self::worldX(min($lons), $z);
            $h = self::worldY(min($lats), $z) - self::worldY(max($lats), $z);
            if ($w <= $this->width - 2 * $pad && $h <= $this->height - 2 * $pad) {
                break;
            }
        }
        $this->zoom = $z;
        $cx = (self::worldX(max($lons), $z) + self::worldX(min($lons), $z)) / 2;
        $cy = (self::worldY(min($lats), $z) + self::worldY(max($lats), $z)) / 2;
        $this->originX = $cx - $this->width / 2;
        $this->originY = $cy - $this->height / 2;
    }

    // --- Tuiles ------------------------------------------------------------------

    private function drawTiles(GdImage $img): void
    {
        $template = Config::get('TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
        $retina = Config::get('TILE_RETINA') === '1';
        $z = $this->zoom;
        $n = 2 ** $z;
        $x0 = (int) floor($this->originX / self::TILE);
        $y0 = max(0, (int) floor($this->originY / self::TILE));
        $x1 = (int) floor(($this->originX + $this->width) / self::TILE);
        $y1 = min($n - 1, (int) floor(($this->originY + $this->height) / self::TILE));

        $wanted = [];
        for ($ty = $y0; $ty <= $y1; $ty++) {
            for ($tx = $x0; $tx <= $x1; $tx++) {
                $wx = (($tx % $n) + $n) % $n;
                $url = strtr($template, [
                    '{z}' => $z, '{x}' => $wx, '{y}' => $ty,
                    '{s}' => ['a', 'b', 'c'][($wx + $ty) % 3],
                    '{r}' => $retina ? '@2x' : '',
                ]);
                $wanted[] = [$tx, $ty, $url];
            }
        }
        $files = $this->fetchTiles(array_column($wanted, 2));
        $s = $this->scale;
        foreach ($wanted as [$tx, $ty, $url]) {
            $file = $files[$url] ?? null;
            $tile = $file ? @imagecreatefromstring((string) file_get_contents($file)) : false;
            if (!$tile) {
                continue;
            }
            $dx = (int) round(($tx * self::TILE - $this->originX) * $s);
            $dy = (int) round(($ty * self::TILE - $this->originY) * $s);
            $size = self::TILE * $s;
            imagecopyresampled($img, $tile, $dx, $dy, 0, 0, $size, $size, imagesx($tile), imagesy($tile));
        }
    }

    /** Télécharge les tuiles manquantes en parallèle ; cache disque permanent. */
    private function fetchTiles(array $urls): array
    {
        $dir = Config::dataDir() . '/tiles';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $result = [];
        $offline = "$dir/.offline";
        $skipNetwork = is_file($offline) && filemtime($offline) > time() - 300;
        $mh = curl_multi_init();
        $handles = [];
        foreach (array_unique($urls) as $url) {
            $file = $dir . '/' . sha1($url) . '.tile';
            if (is_file($file) && filesize($file) > 0) {
                $result[$url] = $file;
                continue;
            }
            if ($skipNetwork) {
                continue;
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 20,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_HTTPHEADER => ['User-Agent: ' . Config::userAgent()],
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$url] = [$ch, $file];
        }
        if ($handles) {
            do {
                $status = curl_multi_exec($mh, $running);
                if ($running) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running && $status === CURLM_OK);
            $reached = false;
            foreach ($handles as $url => [$ch, $file]) {
                $body = curl_multi_getcontent($ch);
                $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $reached = $reached || $code > 0;
                if ($code === 200 && $body) {
                    file_put_contents($file, $body);
                    $result[$url] = $file;
                }
                curl_multi_remove_handle($mh, $ch);
            }
            $reached ? @unlink($offline) : touch($offline);
        }
        curl_multi_close($mh);
        return $result;
    }

    // --- Dessin ------------------------------------------------------------------

    private function drawPath(GdImage $img): void
    {
        $s = $this->scale;
        $color = imagecolorallocate($img, 214, 72, 52);
        $halo = imagecolorallocatealpha($img, 255, 255, 255, 40);
        for ($i = 1; $i < count($this->path); $i++) {
            [$la1, $lo1] = $this->path[$i - 1];
            [$la2, $lo2] = $this->path[$i];
            [$x1, $y1] = $this->project($la1, $lo1);
            [$x2, $y2] = $this->project($la2, $lo2);
            $flight = self::distanceKm($la1, $lo1, $la2, $lo2) > self::FLIGHT_KM;
            // Courbe de Bézier quadratique : légère pour la route, arquée pour un vol.
            $bend = $flight ? 0.2 : 0.0;
            $mx = ($x1 + $x2) / 2 - ($y2 - $y1) * $bend;
            $my = ($y1 + $y2) / 2 + ($x2 - $x1) * $bend;
            $pts = [];
            $steps = $flight ? 48 : 1;
            for ($k = 0; $k <= $steps; $k++) {
                $t = $k / $steps;
                $pts[] = [
                    ((1 - $t) ** 2 * $x1 + 2 * (1 - $t) * $t * $mx + $t ** 2 * $x2) * $s,
                    ((1 - $t) ** 2 * $y1 + 2 * (1 - $t) * $t * $my + $t ** 2 * $y2) * $s,
                ];
            }
            for ($k = 1; $k < count($pts); $k++) {
                if ($flight && $k % 2 === 0) {
                    continue; // pointillés
                }
                $this->thickLine($img, $pts[$k - 1], $pts[$k], 6 * $s, $halo);
                $this->thickLine($img, $pts[$k - 1], $pts[$k], 3 * $s, $color);
            }
        }
    }

    /** Trait épais aux extrémités arrondies (imagesetthickness ignore l'anticrénelage). */
    private function thickLine(GdImage $img, array $a, array $b, float $width, int $color): void
    {
        $dx = $b[0] - $a[0];
        $dy = $b[1] - $a[1];
        $len = sqrt($dx * $dx + $dy * $dy);
        $r = $width / 2;
        if ($len > 0.01) {
            $nx = -$dy / $len * $r;
            $ny = $dx / $len * $r;
            imagefilledpolygon($img, array_map('intval', array_map('round', [
                $a[0] + $nx, $a[1] + $ny, $b[0] + $nx, $b[1] + $ny,
                $b[0] - $nx, $b[1] - $ny, $a[0] - $nx, $a[1] - $ny,
            ])), $color);
        }
        imagefilledellipse($img, (int) round($a[0]), (int) round($a[1]), (int) round($width), (int) round($width), $color);
        imagefilledellipse($img, (int) round($b[0]), (int) round($b[1]), (int) round($width), (int) round($width), $color);
    }

    private function disc(GdImage $img, float $x, float $y, float $r, array $border, array $fill): void
    {
        $d = (int) round($r * 2);
        imagefilledellipse($img, (int) round($x), (int) round($y), $d + (int) round($r * 0.6), $d + (int) round($r * 0.6), imagecolorallocate($img, ...$border));
        imagefilledellipse($img, (int) round($x), (int) round($y), $d, $d, imagecolorallocate($img, ...$fill));
    }

    private function drawMarker(GdImage $img, array $m): void
    {
        $s = $this->scale;
        [$x, $y] = $this->project($m['lat'], $m['lon']);
        $x *= $s;
        $y *= $s;
        $font = self::font();
        $number = isset($m['number']) ? (string) $m['number'] : '';
        $r = ($number !== '' ? 13 : 7) * $s;
        $this->disc($img, $x, $y, $r, [255, 255, 255], [214, 72, 52]);
        $white = imagecolorallocate($img, 255, 255, 255);
        $ink = imagecolorallocate($img, 33, 37, 41);
        if ($number !== '' && $font) {
            $size = (strlen($number) > 1 ? 10 : 12) * $s;
            $box = imagettfbbox($size, 0, $font, $number);
            $tw = $box[2] - $box[0];
            $th = $box[1] - $box[7];
            imagettftext($img, $size, 0, (int) round($x - $tw / 2 - $box[0]), (int) round($y + $th / 2), $white, $font, $number);
        }
        $label = trim((string) ($m['label'] ?? ''));
        if ($label !== '' && $font) {
            $size = 13 * $s;
            $box = imagettfbbox($size, 0, $font, $label);
            $tw = $box[2] - $box[0];
            $tx = (int) round($x + $r + 5 * $s);
            if ($tx + $tw > imagesx($img) - 6 * $s) {
                $tx = (int) round($x - $r - 5 * $s - $tw); // à gauche si ça déborde
            }
            $ty = (int) round($y + ($box[1] - $box[7]) / 2);
            $haloColor = imagecolorallocatealpha($img, 255, 255, 255, 20);
            $o = (int) max(2, round(2 * $s));
            for ($dx = -$o; $dx <= $o; $dx += $o) {
                for ($dy = -$o; $dy <= $o; $dy += $o) {
                    imagettftext($img, $size, 0, $tx + $dx, $ty + $dy, $haloColor, $font, $label);
                }
            }
            imagettftext($img, $size, 0, $tx, $ty, $ink, $font, $label);
        }
    }

    private function drawAttribution(GdImage $img): void
    {
        $text = Config::get('TILE_ATTRIBUTION', '© OpenStreetMap contributors');
        $font = self::font(false);
        if ($text === '' || !$font) {
            return;
        }
        $s = $this->scale;
        $size = 7 * $s;
        $box = imagettfbbox($size, 0, $font, $text);
        $tw = $box[2] - $box[0];
        $th = $box[1] - $box[7];
        $w = imagesx($img);
        $h = imagesy($img);
        $p = 3 * $s;
        imagefilledrectangle($img, (int) ($w - $tw - 2 * $p), (int) ($h - $th - 2 * $p), $w, $h, imagecolorallocatealpha($img, 255, 255, 255, 35));
        imagettftext($img, $size, 0, (int) ($w - $tw - $p), (int) ($h - $p - $box[1]), imagecolorallocate($img, 70, 70, 70), $font, $text);
    }

    public static function font(bool $bold = true): ?string
    {
        $candidates = $bold
            ? ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']
            : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'];
        foreach ($candidates as $f) {
            if (is_file($f)) {
                return $f;
            }
        }
        return null;
    }

    public static function distanceKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 6371 * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
