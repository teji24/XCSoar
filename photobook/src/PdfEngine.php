<?php
declare(strict_types=1);

namespace PhotoBook;

/** Conversion HTML → PDF par Chromium : service Gotenberg ou binaire local. */
final class PdfEngine
{
    public static function convert(string $dir): string
    {
        $gotenberg = Config::get('GOTENBERG_URL');
        return $gotenberg !== '' ? self::gotenberg($gotenberg, $dir) : self::chromium($dir);
    }

    private static function gotenberg(string $base, string $dir): string
    {
        $fields = [
            'preferCssPageSize' => 'true',
            'printBackground' => 'true',
            'marginTop' => '0', 'marginBottom' => '0', 'marginLeft' => '0', 'marginRight' => '0',
        ];
        $i = 0;
        foreach (scandir($dir) as $f) {
            if ($f[0] !== '.') {
                $fields['files[' . $i++ . ']'] = new \CURLFile("$dir/$f", null, $f);
            }
        }
        $r = Http::request('POST', rtrim($base, '/') . '/forms/chromium/convert/html', [], $fields, 600);
        if ($r['status'] !== 200) {
            throw new HttpException(502, "Gotenberg a répondu {$r['status']} : " . mb_substr($r['body'], 0, 300));
        }
        return $r['body'];
    }

    private static function chromium(string $dir): string
    {
        $bin = self::findChromium();
        if ($bin === null) {
            throw new HttpException(500, 'Aucun moteur PDF : définir GOTENBERG_URL ou CHROMIUM_BIN.');
        }
        $out = "$dir/.book.pdf";
        $cmd = [$bin];
        if (!str_contains(basename($bin), 'headless-shell')) {
            $cmd[] = '--headless=new';
        }
        array_push($cmd, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
            '--disable-background-networking', '--disable-component-update', '--no-pdf-header-footer',
            '--user-data-dir=' . "$dir/.chrome", '--print-to-pdf=' . $out, 'file://' . $dir . '/index.html');
        $log = "$dir/.chrome.log";
        $proc = proc_open($cmd, [0 => ['file', '/dev/null', 'r'], 1 => ['file', $log, 'w'], 2 => ['file', $log, 'w']], $pipes);
        // Garde-fou : certains Chromium « complets » ne rendent jamais la main en mode headless.
        $deadline = time() + 300;
        while (proc_get_status($proc)['running']) {
            if (time() > $deadline) {
                proc_terminate($proc, 9);
                break;
            }
            usleep(200000);
        }
        proc_close($proc);
        if (!is_file($out) || filesize($out) === 0) {
            $stderr = is_file($log) ? (string) file_get_contents($log) : '';
            throw new HttpException(500, 'Chromium n\'a pas produit de PDF (essayez chrome-headless-shell ou Gotenberg) : ' . mb_substr($stderr, -300));
        }
        return (string) file_get_contents($out);
    }

    private static function findChromium(): ?string
    {
        $bin = Config::get('CHROMIUM_BIN');
        if ($bin !== '') {
            return $bin;
        }
        foreach (['chrome-headless-shell', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'] as $name) {
            $path = trim((string) shell_exec('command -v ' . escapeshellarg($name) . ' 2>/dev/null'));
            if ($path !== '') {
                return $path;
            }
        }
        // Navigateurs installés par Playwright : chrome-headless-shell est le plus fiable pour imprimer.
        $found = array_merge(
            glob('/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell') ?: [],
            glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome') ?: [],
        );
        return $found[0] ?? null;
    }
}
