<?php
declare(strict_types=1);

namespace PhotoBook;

/** Configuration lue depuis l'environnement, avec repli sur le fichier .env. */
final class Config
{
    private static ?array $values = null;

    public static function get(string $key, string $default = ''): string
    {
        if (self::$values === null) {
            self::$values = [];
            $file = dirname(__DIR__) . '/.env';
            if (is_file($file)) {
                foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                    $line = trim($line);
                    if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                        continue;
                    }
                    [$k, $v] = explode('=', $line, 2);
                    self::$values[trim($k)] = trim(trim($v), "\"'");
                }
            }
        }
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        return self::$values[$key] ?? $default;
    }

    public static function dataDir(): string
    {
        $dir = self::get('DATA_DIR', dirname(__DIR__) . '/data');
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        return $dir;
    }

    public static function userAgent(): string
    {
        $contact = self::get('CONTACT_EMAIL');
        return 'PhotoBook/0.1' . ($contact !== '' ? " ($contact)" : '');
    }
}
