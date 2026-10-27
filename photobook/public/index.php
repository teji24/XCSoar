<?php
declare(strict_types=1);

use PhotoBook\{Config, Format, Geocoder, HttpException, Immich, PdfEngine, Photos, Projects, BookRenderer, Db};

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Serveur PHP intégré : laisser passer les fichiers statiques.
if (PHP_SAPI === 'cli-server' && $path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

spl_autoload_register(function (string $class): void {
    if (str_starts_with($class, 'PhotoBook\\')) {
        require dirname(__DIR__) . '/src/' . substr($class, 10) . '.php';
    }
});

if (!str_starts_with($path, '/api/')) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/app.html');
    return;
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function json_in(): array
{
    $data = json_decode((string) file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function send_file(string $file, string $type, int $maxAge = 3600): void
{
    if (!is_file($file)) {
        throw new HttpException(404, 'Fichier introuvable.');
    }
    header("Content-Type: $type");
    header('Content-Length: ' . filesize($file));
    header("Cache-Control: private, max-age=$maxAge");
    readfile($file);
}

$method = $_SERVER['REQUEST_METHOD'];
$id = '([0-9a-f]{16})';
$routes = [
    ['GET', '#^/api/config$#', function () {
        json_out([
            'immich' => Immich::enabled(),
            'formats' => array_map(fn ($s) => ['width' => $s[0], 'height' => $s[1], 'label' => $s[2]], Format::SIZES),
            'layouts' => Format::layouts(),
            'tileUrl' => strtr(Config::get('TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), ['{r}' => '']),
            'tileAttribution' => Config::get('TILE_ATTRIBUTION', '© OpenStreetMap contributors'),
            'dpi' => BookRenderer::DPI,
        ]);
    }],
    ['GET', '#^/api/projects$#', fn () => json_out(Projects::all())],
    ['POST', '#^/api/projects$#', fn () => json_out(Projects::create((string) (json_in()['name'] ?? '')), 201)],
    ['GET', "#^/api/projects/$id$#", function ($pid) {
        json_out(Projects::get($pid) + ['photos' => Photos::list($pid)]);
    }],
    ['PUT', "#^/api/projects/$id$#", fn ($pid) => json_out(Projects::save($pid, json_in()))],
    ['DELETE', "#^/api/projects/$id$#", function ($pid) {
        Projects::delete($pid);
        json_out(['ok' => true]);
    }],
    ['POST', "#^/api/projects/$id/photos$#", function ($pid) {
        Projects::get($pid);
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            throw new HttpException(400, 'Envoi du fichier échoué (taille maximale dépassée ?).');
        }
        $meta = isset($_POST['lastModified']) ? ['fileTs' => (int) ($_POST['lastModified'] / 1000)] : [];
        json_out(Photos::import($pid, $f['tmp_name'], basename((string) $f['name']), $meta), 201);
    }],
    ['PATCH', "#^/api/projects/$id/photos/$id$#", fn ($pid, $ph) => json_out(Photos::update($pid, $ph, json_in()))],
    ['DELETE', "#^/api/projects/$id/photos/$id$#", function ($pid, $ph) {
        Photos::delete($pid, $ph);
        json_out(['ok' => true]);
    }],
    ['GET', "#^/api/projects/$id/photos/$id/preview$#", function ($pid, $ph) {
        send_file(Photos::previewPath(Photos::get($pid, $ph)), 'image/jpeg', 86400);
    }],
    ['GET', "#^/api/projects/$id/pages/([A-Za-z0-9_-]{1,40})/map$#", function ($pid, $pageId) {
        $project = Projects::get($pid);
        $page = null;
        foreach ($project['pages'] ?? [] as $p) {
            if (($p['id'] ?? '') === $pageId) {
                $page = $p;
            }
        }
        if (!$page) {
            throw new HttpException(404, 'Page introuvable.');
        }
        $renderer = new BookRenderer($project, Photos::list($pid));
        $img = $renderer->buildMap($page, $renderer->mapRect($page), 1)->render();
        header('Content-Type: image/png');
        header('Cache-Control: private, max-age=86400'); // l'URL change avec le contenu (?v=)
        imagepng($img, null, 6);
    }],
    ['POST', "#^/api/projects/$id/pdf$#", function ($pid) {
        @set_time_limit(900);
        $project = Projects::get($pid);
        if (empty($project['pages'])) {
            throw new HttpException(400, 'Le livre ne contient aucune page.');
        }
        $dir = sys_get_temp_dir() . '/photobook-' . Db::newId();
        mkdir($dir, 0775, true);
        try {
            (new BookRenderer($project, Photos::list($pid)))->renderTo($dir);
            $pdf = PdfEngine::convert($dir);
        } finally {
            exec('rm -rf ' . escapeshellarg($dir));
        }
        $name = preg_replace('/[^A-Za-z0-9 _-]+/', '', iconv('UTF-8', 'ASCII//TRANSLIT', $project['name']) ?: 'livre') ?: 'livre';
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . trim($name) . '.pdf"');
        header('Content-Length: ' . strlen($pdf));
        echo $pdf;
    }],
    ['GET', '#^/api/geocode$#', function () {
        if (!isset($_GET['lat'], $_GET['lon'])) {
            throw new HttpException(400, 'lat et lon requis.');
        }
        json_out(Geocoder::reverse((float) $_GET['lat'], (float) $_GET['lon']));
    }],
    ['GET', '#^/api/immich/albums$#', fn () => json_out(Immich::albums())],
    ['GET', '#^/api/immich/albums/([0-9a-f-]{36})$#', fn ($aid) => json_out(Immich::albumAssets($aid))],
    ['GET', '#^/api/immich/thumb/([0-9a-f-]{36})$#', function ($aid) {
        $r = Immich::thumbnail($aid);
        header('Content-Type: ' . ($r['type'] ?: 'image/jpeg'));
        header('Cache-Control: private, max-age=86400');
        echo $r['body'];
    }],
    ['POST', "#^/api/projects/$id/immich$#", function ($pid) {
        Projects::get($pid);
        json_out(Immich::import($pid, (string) (json_in()['assetId'] ?? '')), 201);
    }],
];

try {
    foreach ($routes as [$m, $pattern, $handler]) {
        if ($m === $method && preg_match($pattern, $path, $args)) {
            array_shift($args);
            $handler(...$args);
            return;
        }
    }
    throw new HttpException(404, 'Route inconnue.');
} catch (HttpException $e) {
    json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log((string) $e);
    json_out(['error' => 'Erreur interne : ' . $e->getMessage()], 500);
}
