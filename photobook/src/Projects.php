<?php
declare(strict_types=1);

namespace PhotoBook;

/**
 * Un projet = un document JSON (format, réglages, étapes du voyage, pages).
 * Les photos sont stockées à part (table photos) pour que les imports parallèles
 * et les sauvegardes de l'éditeur ne s'écrasent pas.
 */
final class Projects
{
    public static function all(): array
    {
        $rows = Db::pdo()->query('SELECT id, name, created_at, updated_at,
            (SELECT COUNT(*) FROM photos WHERE photos.project_id = projects.id) AS photo_count
            FROM projects ORDER BY updated_at DESC')->fetchAll();
        return array_map(fn ($r) => [
            'id' => $r['id'],
            'name' => $r['name'],
            'createdAt' => (int) $r['created_at'],
            'updatedAt' => (int) $r['updated_at'],
            'photoCount' => (int) $r['photo_count'],
        ], $rows);
    }

    public static function create(string $name): array
    {
        $doc = [
            'id' => Db::newId(),
            'name' => trim($name) !== '' ? mb_substr(trim($name), 0, 120) : 'Mon livre photo',
            'format' => Format::DEFAULT,
            'trip' => ['steps' => 0, 'distanceKm' => 20, 'gapHours' => 48, 'cameraOffsets' => (object) []],
            'clusters' => [],
            'pages' => [],
        ];
        $now = time();
        Db::pdo()->prepare('INSERT INTO projects (id, name, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$doc['id'], $doc['name'], json_encode($doc, JSON_UNESCAPED_UNICODE), $now, $now]);
        return $doc;
    }

    public static function get(string $id): array
    {
        $st = Db::pdo()->prepare('SELECT doc FROM projects WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpException(404, 'Projet introuvable.');
        }
        return json_decode($row['doc'], true);
    }

    public static function save(string $id, array $doc): array
    {
        self::get($id);
        $doc['id'] = $id;
        $doc['name'] = mb_substr(trim((string) ($doc['name'] ?? '')), 0, 120) ?: 'Mon livre photo';
        unset($doc['photos']);
        Db::pdo()->prepare('UPDATE projects SET name = ?, doc = ?, updated_at = ? WHERE id = ?')
            ->execute([$doc['name'], json_encode($doc, JSON_UNESCAPED_UNICODE), time(), $id]);
        return $doc;
    }

    public static function delete(string $id): void
    {
        self::get($id);
        $pdo = Db::pdo();
        $pdo->prepare('DELETE FROM photos WHERE project_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM projects WHERE id = ?')->execute([$id]);
        self::removeDir(Config::dataDir() . "/projects/$id");
    }

    private static function removeDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            $p = "$dir/$f";
            is_dir($p) ? self::removeDir($p) : unlink($p);
        }
        rmdir($dir);
    }
}
