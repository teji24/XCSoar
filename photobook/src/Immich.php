<?php
declare(strict_types=1);

namespace PhotoBook;

/** Accès à un serveur Immich via son API REST (clé API côté serveur uniquement). */
final class Immich
{
    public static function enabled(): bool
    {
        return Config::get('IMMICH_URL') !== '' && Config::get('IMMICH_API_KEY') !== '';
    }

    private static function url(string $path): string
    {
        if (!self::enabled()) {
            throw new HttpException(400, 'Immich n\'est pas configuré (IMMICH_URL et IMMICH_API_KEY).');
        }
        return rtrim(Config::get('IMMICH_URL'), '/') . '/api' . $path;
    }

    private static function headers(): array
    {
        return ['x-api-key: ' . Config::get('IMMICH_API_KEY')];
    }

    public static function albums(): array
    {
        $albums = Http::getJson(self::url('/albums'), self::headers());
        $out = array_map(fn ($a) => [
            'id' => $a['id'],
            'name' => $a['albumName'] ?? '',
            'count' => $a['assetCount'] ?? 0,
            'start' => $a['startDate'] ?? null,
            'end' => $a['endDate'] ?? null,
            'thumbnail' => $a['albumThumbnailAssetId'] ?? null,
        ], $albums);
        usort($out, fn ($a, $b) => strcmp((string) $b['start'], (string) $a['start']));
        return $out;
    }

    public static function albumAssets(string $albumId): array
    {
        self::checkId($albumId);
        $album = Http::getJson(self::url("/albums/$albumId"), self::headers());
        $assets = [];
        foreach ($album['assets'] ?? [] as $a) {
            if (($a['type'] ?? '') !== 'IMAGE') {
                continue;
            }
            $assets[] = ['id' => $a['id'], 'name' => $a['originalFileName'] ?? $a['id']] + self::meta($a);
        }
        usort($assets, fn ($a, $b) => ($a['ts'] ?? 0) <=> ($b['ts'] ?? 0));
        return $assets;
    }

    /** Métadonnées Immich converties au format d'une photo du projet. */
    private static function meta(array $a): array
    {
        $x = $a['exifInfo'] ?? [];
        $iso = $x['dateTimeOriginal'] ?? $a['fileCreatedAt'] ?? null;
        $ts = $iso ? strtotime($iso) : null;
        $takenAt = null;
        if ($ts) {
            $tz = null;
            try {
                $tz = !empty($x['timeZone']) ? new \DateTimeZone($x['timeZone']) : null;
            } catch (\Exception) {
            }
            $d = (new \DateTimeImmutable('@' . $ts))->setTimezone($tz ?? new \DateTimeZone('UTC'));
            $takenAt = $d->format('Y-m-d\TH:i:s');
        }
        $lat = isset($x['latitude']) ? (float) $x['latitude'] : null;
        $lon = isset($x['longitude']) ? (float) $x['longitude'] : null;
        return [
            'ts' => $ts,
            'takenAt' => $takenAt,
            'lat' => $lat,
            'lon' => $lat === null ? null : $lon,
            'city' => $x['city'] ?? null,
            'country' => $x['country'] ?? null,
            'camera' => trim(($x['make'] ?? '') . ' ' . ($x['model'] ?? '')) ?: null,
            'orientationHint' => $x['orientation'] ?? null,
        ];
    }

    public static function thumbnail(string $assetId): array
    {
        self::checkId($assetId);
        $r = Http::request('GET', self::url("/assets/$assetId/thumbnail?size=thumbnail"), self::headers());
        if ($r['status'] >= 400) {
            throw new HttpException(502, 'Vignette Immich indisponible.');
        }
        return $r;
    }

    /** Télécharge l'original d'un média Immich et l'ajoute au projet. */
    public static function import(string $projectId, string $assetId): array
    {
        self::checkId($assetId);
        $asset = Http::getJson(self::url("/assets/$assetId"), self::headers());
        $tmp = tempnam(sys_get_temp_dir(), 'immich');
        $r = Http::request('GET', self::url("/assets/$assetId/original"), self::headers(), null, 300);
        if ($r['status'] >= 400) {
            throw new HttpException(502, 'Téléchargement de l\'original Immich impossible.');
        }
        file_put_contents($tmp, $r['body']);
        $info = @getimagesize($tmp);
        if (!in_array($info[2] ?? 0, [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
            // HEIC, RAW… : on se rabat sur l'aperçu JPEG généré par Immich (moins défini).
            $r = Http::request('GET', self::url("/assets/$assetId/thumbnail?size=preview"), self::headers(), null, 120);
            file_put_contents($tmp, $r['body']);
            $lowRes = true;
        }
        $meta = self::meta($asset);
        unset($meta['orientationHint']);
        $meta['source'] = 'immich';
        $meta['immichId'] = $assetId;
        if (!empty($lowRes)) {
            $meta['lowResSource'] = true;
            $meta['orientation'] = 1; // l'aperçu Immich est déjà à l'endroit
        }
        return Photos::import($projectId, $tmp, $asset['originalFileName'] ?? "$assetId.jpg", $meta);
    }

    private static function checkId(string $id): void
    {
        if (!preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            throw new HttpException(400, 'Identifiant Immich invalide.');
        }
    }
}
