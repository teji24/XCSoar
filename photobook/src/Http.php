<?php
declare(strict_types=1);

namespace PhotoBook;

/** Petit client HTTP basé sur curl. */
final class Http
{
    /** @return array{status:int, body:string, type:string} */
    public static function request(string $method, string $url, array $headers = [], $body = null, int $timeout = 60): array
    {
        $ch = curl_init($url);
        $headers[] = 'User-Agent: ' . Config::userAgent();
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($ch);
        if ($response === false) {
            $error = curl_error($ch);
            throw new HttpException(502, "Requête vers $url impossible : $error");
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        return ['status' => $status, 'body' => (string) $response, 'type' => $type];
    }

    public static function getJson(string $url, array $headers = []): array
    {
        $headers[] = 'Accept: application/json';
        $r = self::request('GET', $url, $headers);
        if ($r['status'] >= 400) {
            throw new HttpException(502, "Erreur {$r['status']} depuis $url");
        }
        $data = json_decode($r['body'], true);
        if (!is_array($data)) {
            throw new HttpException(502, "Réponse invalide depuis $url");
        }
        return $data;
    }
}
