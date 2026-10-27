<?php
declare(strict_types=1);

namespace PhotoBook;

/** Import et stockage des photos d'un projet. */
final class Photos
{
    public const PREVIEW_SIZE = 1600;

    public static function dir(string $projectId, string $kind): string
    {
        $dir = Config::dataDir() . "/projects/$projectId/$kind";
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        return $dir;
    }

    public static function list(string $projectId): array
    {
        $st = Db::pdo()->prepare('SELECT doc FROM photos WHERE project_id = ? ORDER BY created_at, id');
        $st->execute([$projectId]);
        return array_map(fn ($r) => json_decode($r['doc'], true), $st->fetchAll());
    }

    public static function get(string $projectId, string $photoId): array
    {
        $st = Db::pdo()->prepare('SELECT doc FROM photos WHERE project_id = ? AND id = ?');
        $st->execute([$projectId, $photoId]);
        $row = $st->fetch();
        if (!$row) {
            throw new HttpException(404, 'Photo introuvable.');
        }
        return json_decode($row['doc'], true);
    }

    public static function save(array $photo): void
    {
        $st = Db::pdo()->prepare('UPDATE photos SET doc = ? WHERE id = ? AND project_id = ?');
        $st->execute([json_encode($photo, JSON_UNESCAPED_UNICODE), $photo['id'], $photo['projectId']]);
    }

    /** Modifications autorisées depuis l'éditeur. */
    public static function update(string $projectId, string $photoId, array $changes): array
    {
        $photo = self::get($projectId, $photoId);
        if (array_key_exists('crop', $changes)) {
            $c = $changes['crop'];
            $photo['crop'] = is_array($c) ? [
                'x' => max(0.0, min(1.0, (float) $c['x'])),
                'y' => max(0.0, min(1.0, (float) $c['y'])),
                'w' => max(0.01, min(1.0, (float) $c['w'])),
                'h' => max(0.01, min(1.0, (float) $c['h'])),
            ] : null;
        }
        foreach (['brightness', 'contrast'] as $k) {
            if (isset($changes[$k])) {
                $photo[$k] = max(-100, min(100, (int) $changes[$k]));
            }
        }
        if (array_key_exists('lat', $changes) && array_key_exists('lon', $changes)) {
            $photo['lat'] = $changes['lat'] === null ? null : (float) $changes['lat'];
            $photo['lon'] = $changes['lon'] === null ? null : (float) $changes['lon'];
        }
        if (isset($changes['caption'])) {
            $photo['caption'] = mb_substr((string) $changes['caption'], 0, 300);
        }
        self::save($photo);
        return $photo;
    }

    public static function delete(string $projectId, string $photoId): void
    {
        $photo = self::get($projectId, $photoId);
        @unlink(self::originalPath($photo));
        @unlink(self::previewPath($photo));
        Db::pdo()->prepare('DELETE FROM photos WHERE id = ? AND project_id = ?')->execute([$photoId, $projectId]);
    }

    public static function originalPath(array $photo): string
    {
        return self::dir($photo['projectId'], 'originals') . '/' . $photo['file'];
    }

    public static function previewPath(array $photo): string
    {
        return self::dir($photo['projectId'], 'previews') . '/' . $photo['id'] . '.jpg';
    }

    /**
     * Importe un fichier image. $meta permet de fournir des métadonnées déjà connues
     * (Immich) qui priment sur l'EXIF du fichier.
     */
    public static function import(string $projectId, string $tmpPath, string $originalName, array $meta = []): array
    {
        $info = @getimagesize($tmpPath);
        $ext = match ($info[2] ?? 0) {
            IMAGETYPE_JPEG => 'jpg',
            IMAGETYPE_PNG => 'png',
            IMAGETYPE_WEBP => 'webp',
            default => throw new HttpException(415, "« $originalName » : format non pris en charge (JPEG, PNG ou WebP)."),
        };
        $id = Db::newId();
        $exif = $ext === 'jpg' ? Exif::read($tmpPath) : [];
        $photo = array_merge([
            'id' => $id,
            'projectId' => $projectId,
            'file' => "$id.$ext",
            'name' => $originalName,
            'source' => 'upload',
            'orientation' => 1,
            'takenAt' => null,
            'ts' => null,
            'lat' => null,
            'lon' => null,
            'city' => null,
            'country' => null,
            'camera' => null,
            'crop' => null,
            'brightness' => 0,
            'contrast' => 0,
            'caption' => '',
        ], array_filter($exif, fn ($v) => $v !== null), array_filter($meta, fn ($v) => $v !== null));

        $dest = self::dir($projectId, 'originals') . '/' . $photo['file'];
        if (!(is_uploaded_file($tmpPath) ? move_uploaded_file($tmpPath, $dest) : rename($tmpPath, $dest))) {
            throw new HttpException(500, 'Impossible d\'enregistrer le fichier.');
        }

        $img = ImageProcessor::load($dest, (int) $photo['orientation']);
        $photo['width'] = imagesx($img);
        $photo['height'] = imagesy($img);
        $preview = ImageProcessor::resizeToFit($img, self::PREVIEW_SIZE);
        imagejpeg($preview, self::previewPath($photo), 85);
        unset($img, $preview);

        if ($photo['ts'] === null) {
            // Sans date EXIF : date du fichier, pour garder un ordre plausible.
            $photo['ts'] = (int) ($meta['fileTs'] ?? time());
            $photo['takenAt'] = gmdate('Y-m-d\TH:i:s', $photo['ts']);
            $photo['dateGuessed'] = true;
        }
        unset($photo['fileTs']);

        Db::pdo()->prepare('INSERT INTO photos (id, project_id, doc, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$id, $projectId, json_encode($photo, JSON_UNESCAPED_UNICODE), time()]);
        return $photo;
    }
}
