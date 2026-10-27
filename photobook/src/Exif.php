<?php
declare(strict_types=1);

namespace PhotoBook;

/** Lecture des métadonnées utiles : date de prise de vue, position GPS, orientation, appareil. */
final class Exif
{
    public static function read(string $path): array
    {
        $e = @exif_read_data($path, null, false);
        if (!is_array($e)) {
            return [];
        }
        $out = ['orientation' => (int) ($e['Orientation'] ?? 1)];

        $date = $e['DateTimeOriginal'] ?? $e['DateTimeDigitized'] ?? $e['DateTime'] ?? null;
        if (is_string($date) && preg_match('/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/', $date, $m)) {
            // takenAt = heure locale affichée ; ts = instant UTC si le décalage est connu,
            // sinon l'heure locale lue comme UTC (cohérent pour un même appareil).
            $local = "$m[1]-$m[2]-$m[3]T$m[4]:$m[5]:$m[6]";
            $offset = $e['OffsetTimeOriginal'] ?? $e['OffsetTime'] ?? null;
            $ts = strtotime($local . 'Z');
            if (is_string($offset) && preg_match('/^([+-])(\d\d):(\d\d)$/', $offset, $o)) {
                $ts -= ($o[1] === '-' ? -1 : 1) * ((int) $o[2] * 3600 + (int) $o[3] * 60);
                $out['tzOffset'] = $offset;
            }
            $out['takenAt'] = $local;
            $out['ts'] = $ts;
        }

        $lat = self::coord($e['GPSLatitude'] ?? null, $e['GPSLatitudeRef'] ?? 'N');
        $lon = self::coord($e['GPSLongitude'] ?? null, $e['GPSLongitudeRef'] ?? 'E');
        if ($lat !== null && $lon !== null && !($lat == 0.0 && $lon == 0.0)) {
            $out['lat'] = $lat;
            $out['lon'] = $lon;
        }

        $camera = trim(($e['Make'] ?? '') . ' ' . ($e['Model'] ?? ''));
        if ($camera !== '') {
            $out['camera'] = $camera;
        }
        return $out;
    }

    private static function coord($parts, string $ref): ?float
    {
        if (!is_array($parts) || count($parts) < 3) {
            return null;
        }
        $v = self::rational($parts[0]) + self::rational($parts[1]) / 60 + self::rational($parts[2]) / 3600;
        return in_array(strtoupper($ref), ['S', 'W'], true) ? -$v : $v;
    }

    private static function rational($r): float
    {
        if (is_string($r) && str_contains($r, '/')) {
            [$n, $d] = explode('/', $r, 2);
            return (float) $d == 0.0 ? 0.0 : (float) $n / (float) $d;
        }
        return (float) $r;
    }
}
