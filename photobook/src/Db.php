<?php
declare(strict_types=1);

namespace PhotoBook;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $pdo = new PDO('sqlite:' . Config::dataDir() . '/photobook.sqlite');
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 10000');
            $pdo->exec('CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
            $pdo->exec('CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, doc TEXT NOT NULL,
                created_at INTEGER NOT NULL)');
            $pdo->exec('CREATE INDEX IF NOT EXISTS photos_project ON photos(project_id)');
            $pdo->exec('CREATE TABLE IF NOT EXISTS geocode_cache (
                key TEXT PRIMARY KEY, doc TEXT NOT NULL)');
            self::$pdo = $pdo;
        }
        return self::$pdo;
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(8));
    }
}
