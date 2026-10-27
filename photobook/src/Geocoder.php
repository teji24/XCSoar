<?php
declare(strict_types=1);

namespace PhotoBook;

/** Géocodage inverse via Nominatim (OpenStreetMap), avec cache et limite d'une requête par seconde. */
final class Geocoder
{
    /** @return array{city:?string, country:?string, label:?string} */
    public static function reverse(float $lat, float $lon): array
    {
        $key = sprintf('%.3f,%.3f', $lat, $lon);
        $pdo = Db::pdo();
        $st = $pdo->prepare('SELECT doc FROM geocode_cache WHERE key = ?');
        $st->execute([$key]);
        if ($row = $st->fetch()) {
            return json_decode($row['doc'], true);
        }

        // Service injoignable récemment : inutile d'attendre un nouveau délai d'expiration.
        $offline = Config::dataDir() . '/nominatim.offline';
        if (is_file($offline) && filemtime($offline) > time() - 300) {
            throw new HttpException(503, 'Service de géocodage injoignable.');
        }
        self::throttle();
        $url = rtrim(Config::get('NOMINATIM_URL', 'https://nominatim.openstreetmap.org'), '/')
            . '/reverse?' . http_build_query([
                'format' => 'jsonv2', 'lat' => $lat, 'lon' => $lon, 'zoom' => 10,
                'accept-language' => 'fr', 'addressdetails' => 1,
            ]);
        try {
            $data = Http::getJson($url);
        } catch (HttpException $e) {
            touch($offline);
            throw $e;
        }
        $a = $data['address'] ?? [];
        $city = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['county'] ?? $a['state'] ?? null;
        $result = [
            'city' => $city,
            'country' => $a['country'] ?? null,
            'label' => $city ?? ($data['name'] ?? null),
        ];
        $pdo->prepare('INSERT OR REPLACE INTO geocode_cache (key, doc) VALUES (?, ?)')
            ->execute([$key, json_encode($result, JSON_UNESCAPED_UNICODE)]);
        return $result;
    }

    /** Garantit au moins une seconde entre deux appels, même entre requêtes PHP concurrentes. */
    private static function throttle(): void
    {
        $fh = fopen(Config::dataDir() . '/nominatim.lock', 'c+');
        flock($fh, LOCK_EX);
        $last = (float) stream_get_contents($fh);
        $wait = $last + 1.1 - microtime(true);
        if ($wait > 0) {
            usleep((int) ($wait * 1e6));
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, (string) microtime(true));
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}
