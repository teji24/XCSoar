<?php
declare(strict_types=1);

namespace PhotoBook;

/**
 * Transforme un projet en un document HTML imprimable (une page CSS par page du livre)
 * accompagné de ses images, prêt à être converti en PDF par Chromium.
 */
final class BookRenderer
{
    public const DPI = 300;
    /** Résolution « logique » des cartes ; rendues ensuite en ×2 (240 dpi) : les libellés des tuiles restent lisibles. */
    public const MAP_DPI = 120;

    private array $photos = [];
    private array $clusters = [];
    private array $page;

    public function __construct(private array $project, array $photos)
    {
        foreach ($photos as $p) {
            $this->photos[$p['id']] = $p;
        }
        foreach ($project['clusters'] ?? [] as $c) {
            $this->clusters[$c['id']] = $c;
        }
        $this->page = Format::page($project['format'] ?? []);
    }

    /** Écrit index.html et les images dans $dir. */
    public function renderTo(string $dir): void
    {
        $pg = $this->page;
        $W = $pg['width'] + 2 * $pg['bleed'];
        $H = $pg['height'] + 2 * $pg['bleed'];
        $body = '';
        foreach (array_values($this->project['pages'] ?? []) as $i => $page) {
            $body .= $this->renderPage($page, $i, $dir);
        }
        $css = <<<CSS
@page { size: {$W}mm {$H}mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: "DejaVu Sans", "Noto Sans", Arial, sans-serif; color: #222; }
.page { position: relative; width: {$W}mm; height: {$H}mm; overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.el { position: absolute; overflow: hidden; }
.el img { display: block; width: 100%; height: 100%; }
.title { font-family: "DejaVu Serif", "Noto Serif", Georgia, serif; font-weight: bold; line-height: 1.15; }
.subtitle { color: #666; margin-top: 2mm; }
.cover-box { background: rgba(255,255,255,0.88); padding: 6mm 8mm; }
.caption { position: absolute; font-size: 7.5pt; color: #555; line-height: 1.2; overflow: hidden; }
CSS;
        $html = "<!doctype html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\"><title>"
            . self::e($this->project['name'] ?? 'Livre photo')
            . "</title><style>$css</style></head><body>\n$body</body></html>\n";
        file_put_contents("$dir/index.html", $html);
    }

    private function renderPage(array $page, int $index, string $dir): string
    {
        $type = $page['type'] ?? 'photos';
        $out = '';
        switch ($type) {
            case 'cover':
                $out .= $this->photoSlots($page, $index, $dir, 'full-bleed');
                $out .= $this->coverText($page);
                break;
            case 'overview':
                [$titleRect, $mapRect] = $this->overviewRects();
                $out .= $this->textBlock($titleRect, $page['title'] ?? '', $page['subtitle'] ?? '', 20);
                $out .= $this->mapElement($page, $mapRect, "map-$index.png", $dir);
                break;
            case 'chapter':
                [$mapRect, $textRect] = $this->chapterRects();
                $out .= $this->mapElement($page, $mapRect, "map-$index.png", $dir);
                $out .= $this->textBlock($textRect, $page['title'] ?? '', $page['subtitle'] ?? '', 24);
                break;
            default:
                $out .= $this->photoSlots($page, $index, $dir, $page['layout'] ?? 'single');
        }
        return "<section class=\"page\">$out</section>\n";
    }

    private function photoSlots(array $page, int $index, string $dir, string $layoutId): string
    {
        $layout = Format::layouts()[$layoutId] ?? Format::layouts()['single'];
        $out = '';
        foreach ($layout['slots'] as $k => $slot) {
            $photoId = $page['slots'][$k] ?? null;
            if (!$photoId || !isset($this->photos[$photoId])) {
                continue;
            }
            $photo = $this->photos[$photoId];
            $r = Format::slotRect($this->page, $slot, !empty($layout['bleed']));
            $file = "img-$index-$k.jpg";
            $res = ImageProcessor::renderSlot($photo, Photos::originalPath($photo), $r['w'], $r['h'], self::DPI);
            imagejpeg($res['image'], "$dir/$file", 90);
            unset($res);
            $out .= '<div class="el" style="' . self::box($r) . "\"><img src=\"$file\" alt=\"\"></div>";
            $caption = trim((string) ($photo['caption'] ?? ''));
            if ($caption !== '' && empty($layout['bleed'])) {
                $c = ['x' => $r['x'], 'y' => $r['y'] + $r['h'] + 0.8, 'w' => $r['w'], 'h' => 4];
                $out .= '<div class="caption" style="' . self::box($c) . '">' . self::e($caption) . '</div>';
            }
        }
        return $out;
    }

    private function coverText(array $page): string
    {
        $title = trim((string) ($page['title'] ?? ''));
        if ($title === '') {
            return '';
        }
        $pg = $this->page;
        $b = $pg['bleed'];
        $w = $pg['width'] * 0.7;
        $style = sprintf('left:%.2fmm;bottom:%.2fmm;width:%.2fmm;', $b + ($pg['width'] - $w) / 2, $b + $pg['height'] * 0.1, $w);
        $size = round(min($pg['width'], $pg['height']) / 210 * 30, 1);
        return "<div class=\"el cover-box\" style=\"$style text-align:center\"><div class=\"title\" style=\"font-size:{$size}pt\">"
            . self::e($title) . '</div>'
            . (trim((string) ($page['subtitle'] ?? '')) !== '' ? '<div class="subtitle" style="font-size:' . round($size * 0.45, 1) . 'pt">' . self::e($page['subtitle']) . '</div>' : '')
            . '</div>';
    }

    private function textBlock(array $r, string $title, string $subtitle, float $titlePt): string
    {
        $scale = min($this->page['width'], $this->page['height']) / 210;
        $size = round($titlePt * $scale, 1);
        return '<div class="el" style="' . self::box($r) . '"><div class="title" style="font-size:' . $size . 'pt">' . self::e($title) . '</div>'
            . ($subtitle !== '' ? '<div class="subtitle" style="font-size:' . round($size * 0.45, 1) . 'pt">' . self::e($subtitle) . '</div>' : '')
            . '</div>';
    }

    private function mapElement(array $page, array $r, string $file, string $dir): string
    {
        $map = $this->buildMap($page, $r, 2);
        imagepng($map->render(), "$dir/$file", 6);
        return '<div class="el" style="' . self::box($r) . "\"><img src=\"$file\" alt=\"\"></div>";
    }

    // --- Géométrie des pages spéciales (partagée avec l'aperçu via mapForPage) ---

    public function overviewRects(): array
    {
        $full = Format::slotRect($this->page, [0, 0, 1, 1], false);
        $band = min(28.0, $full['h'] * 0.16);
        return [
            ['x' => $full['x'], 'y' => $full['y'], 'w' => $full['w'], 'h' => $band],
            ['x' => $full['x'], 'y' => $full['y'] + $band, 'w' => $full['w'], 'h' => $full['h'] - $band],
        ];
    }

    public function chapterRects(): array
    {
        $full = Format::slotRect($this->page, [0, 0, 1, 1], false);
        $mapH = $full['h'] * 0.74;
        return [
            ['x' => $full['x'], 'y' => $full['y'], 'w' => $full['w'], 'h' => $mapH],
            ['x' => $full['x'], 'y' => $full['y'] + $mapH + 6, 'w' => $full['w'], 'h' => $full['h'] - $mapH - 6],
        ];
    }

    public function mapRect(array $page): array
    {
        return ($page['type'] ?? '') === 'overview' ? $this->overviewRects()[1] : $this->chapterRects()[0];
    }

    /** Construit la carte d'une page : vue d'ensemble du voyage ou carte d'une étape. */
    public function buildMap(array $page, array $rect, int $scale): StaticMap
    {
        $w = (int) round($rect['w'] / 25.4 * self::MAP_DPI);
        $h = (int) round($rect['h'] / 25.4 * self::MAP_DPI);
        if (($page['type'] ?? '') === 'overview') {
            $markers = [];
            $path = [];
            foreach (array_values($this->clusters) as $i => $c) {
                if (!isset($c['lat'], $c['lon'])) {
                    continue;
                }
                $markers[] = ['lat' => $c['lat'], 'lon' => $c['lon'], 'number' => $i + 1, 'label' => $c['title'] ?? ''];
                $path[] = [$c['lat'], $c['lon']];
            }
            return new StaticMap($w, $h, $markers, $path, $scale, 12);
        }
        $cluster = $this->clusters[$page['clusterId'] ?? ''] ?? null;
        $dots = [];
        $markers = [];
        if ($cluster) {
            foreach ($cluster['photoIds'] ?? [] as $pid) {
                $p = $this->photos[$pid] ?? null;
                if ($p && $p['lat'] !== null && empty($p['gpsInterpolated'])) {
                    $dots[] = [$p['lat'], $p['lon']];
                }
            }
            $dots = array_values(array_unique($dots, SORT_REGULAR));
            if (isset($cluster['lat'], $cluster['lon'])) {
                $number = array_search($cluster['id'], array_keys($this->clusters), true);
                $markers[] = ['lat' => $cluster['lat'], 'lon' => $cluster['lon'], 'number' => $number === false ? null : $number + 1];
            }
        }
        return new StaticMap($w, $h, $markers, [], $scale, 15, $dots);
    }

    private static function box(array $r): string
    {
        return sprintf('left:%.2fmm;top:%.2fmm;width:%.2fmm;height:%.2fmm;', $r['x'], $r['y'], $r['w'], $r['h']);
    }

    private static function e(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
