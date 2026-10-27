<?php
declare(strict_types=1);

namespace PhotoBook;

use GdImage;

/** Traitements d'image avec GD : orientation EXIF, recadrage, luminosité/contraste, redimensionnement. */
final class ImageProcessor
{
    public static function load(string $path, int $orientation = 1): GdImage
    {
        $info = @getimagesize($path);
        $img = match ($info[2] ?? 0) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
            IMAGETYPE_PNG => @imagecreatefrompng($path),
            IMAGETYPE_WEBP => @imagecreatefromwebp($path),
            default => false,
        };
        if (!$img instanceof GdImage) {
            throw new HttpException(415, 'Format d\'image non pris en charge (JPEG, PNG ou WebP attendu).');
        }
        if (!imageistruecolor($img)) {
            imagepalettetotruecolor($img);
        }
        return self::orient($img, $orientation);
    }

    /** Applique la balise EXIF Orientation pour obtenir l'image « à l'endroit ». */
    public static function orient(GdImage $img, int $orientation): GdImage
    {
        if (in_array($orientation, [2, 4, 5, 7], true)) {
            imageflip($img, IMG_FLIP_HORIZONTAL);
        }
        $angle = match ($orientation) {
            3, 4 => 180,
            5, 6 => 270, // imagerotate tourne dans le sens antihoraire
            7, 8 => 90,
            default => 0,
        };
        if ($angle !== 0) {
            $rotated = imagerotate($img, $angle, 0);
            $img = $rotated;
        }
        return $img;
    }

    public static function resizeToFit(GdImage $img, int $maxSide): GdImage
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1.0, $maxSide / max($w, $h));
        if ($scale >= 1.0) {
            return $img;
        }
        return imagescale($img, max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale)), IMG_BICUBIC);
    }

    /**
     * Région source (en pixels) à extraire pour remplir un emplacement de rapport $aspect :
     * on part du recadrage choisi (fractions de l'image) puis on centre un remplissage « cover ».
     * Même calcul que fitRegion() dans public/js/book.js.
     * @return array{x:float, y:float, w:float, h:float}
     */
    public static function coverRegion(int $imgW, int $imgH, ?array $crop, float $aspect): array
    {
        $c = $crop ?? ['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1];
        $rx = $c['x'] * $imgW;
        $ry = $c['y'] * $imgH;
        $rw = max(1.0, $c['w'] * $imgW);
        $rh = max(1.0, $c['h'] * $imgH);
        if ($rw / $rh > $aspect) {
            $nw = $rh * $aspect;
            $rx += ($rw - $nw) / 2;
            $rw = $nw;
        } else {
            $nh = $rw / $aspect;
            $ry += ($rh - $nh) / 2;
            $rh = $nh;
        }
        return ['x' => $rx, 'y' => $ry, 'w' => $rw, 'h' => $rh];
    }

    /**
     * Luminosité et contraste dans l'intervalle -100..100.
     * Formule identique au filtre SVG de l'aperçu (book.js) : v' = (v + b - 0.5) * k + 0.5
     * avec b = brightness/200 et k = 1 + contrast/100.
     */
    public static function adjust(GdImage $img, int $brightness, int $contrast): void
    {
        if ($brightness === 0 && $contrast === 0) {
            return;
        }
        $b = $brightness / 200 * 255;
        $k = 1 + $contrast / 100;
        // GD : IMG_FILTER_BRIGHTNESS ajoute une constante, IMG_FILTER_CONTRAST applique
        // (v/255 - 0.5) * c + 0.5 avec c = ((100 - n) / 100)^2.
        if ($brightness !== 0) {
            imagefilter($img, IMG_FILTER_BRIGHTNESS, (int) round($b));
        }
        if ($contrast !== 0) {
            imagefilter($img, IMG_FILTER_CONTRAST, (int) round(100 - 100 * sqrt(max(0.0, $k))));
        }
    }

    /**
     * Produit l'image finale d'un emplacement : recadrée, ajustée et dimensionnée pour $dpi.
     * @return array{image:GdImage, dpi:float}
     */
    public static function renderSlot(array $photo, string $path, float $slotWmm, float $slotHmm, int $dpi = 300): array
    {
        $img = self::load($path, (int) ($photo['orientation'] ?? 1));
        $r = self::coverRegion(imagesx($img), imagesy($img), $photo['crop'] ?? null, $slotWmm / $slotHmm);
        $targetW = (int) round($slotWmm / 25.4 * $dpi);
        // On n'agrandit jamais au-delà de la résolution source.
        $outW = max(1, min($targetW, (int) round($r['w'])));
        $outH = max(1, (int) round($outW * $slotHmm / $slotWmm));
        $out = imagecreatetruecolor($outW, $outH);
        imagecopyresampled($out, $img, 0, 0, (int) round($r['x']), (int) round($r['y']), $outW, $outH, (int) round($r['w']), (int) round($r['h']));
        unset($img);
        self::adjust($out, (int) ($photo['brightness'] ?? 0), (int) ($photo['contrast'] ?? 0));
        return ['image' => $out, 'dpi' => $r['w'] / ($slotWmm / 25.4)];
    }
}
