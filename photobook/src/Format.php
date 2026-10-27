<?php
declare(strict_types=1);

namespace PhotoBook;

/** Formats de page (dimensions en millimètres, hors fond perdu). */
final class Format
{
    public const SIZES = [
        'A3' => [297, 420, 'A3'],
        'A4' => [210, 297, 'A4'],
        'A5' => [148, 210, 'A5'],
        'SQ20' => [200, 200, 'Carré 20 cm'],
        'SQ30' => [300, 300, 'Carré 30 cm'],
    ];

    public const DEFAULT = ['size' => 'A4', 'orientation' => 'landscape', 'bleed' => 3, 'margin' => 12, 'gap' => 4];

    /** @return array{width:float, height:float, bleed:float, margin:float, gap:float} */
    public static function page(array $format): array
    {
        $f = array_merge(self::DEFAULT, $format);
        [$w, $h] = self::SIZES[$f['size']] ?? self::SIZES['A4'];
        if ($f['orientation'] === 'landscape' && $w !== $h) {
            [$w, $h] = [$h, $w];
        }
        return [
            'width' => (float) $w,
            'height' => (float) $h,
            'bleed' => max(0.0, min(10.0, (float) $f['bleed'])),
            'margin' => max(0.0, min(40.0, (float) $f['margin'])),
            'gap' => max(0.0, min(20.0, (float) $f['gap'])),
        ];
    }

    public static function layouts(): array
    {
        static $layouts = null;
        return $layouts ??= json_decode(file_get_contents(__DIR__ . '/layouts.json'), true);
    }

    /**
     * Rectangle d'un emplacement en mm, dans le repère de la page avec fond perdu
     * (origine = coin du fond perdu). Les emplacements "bleed" débordent jusqu'au bord coupé.
     * @return array{x:float, y:float, w:float, h:float}
     */
    public static function slotRect(array $page, array $slot, bool $fullBleed): array
    {
        $b = $page['bleed'];
        if ($fullBleed) {
            $x0 = 0.0;
            $y0 = 0.0;
            $cw = $page['width'] + 2 * $b;
            $ch = $page['height'] + 2 * $b;
            $g = 0.0;
        } else {
            $g = $page['gap'];
            // La zone utile est agrandie d'un demi-espace pour que les bords extérieurs tombent sur la marge.
            $x0 = $b + $page['margin'] - $g / 2;
            $y0 = $b + $page['margin'] - $g / 2;
            $cw = $page['width'] - 2 * $page['margin'] + $g;
            $ch = $page['height'] - 2 * $page['margin'] + $g;
        }
        return [
            'x' => $x0 + $slot[0] * $cw + $g / 2,
            'y' => $y0 + $slot[1] * $ch + $g / 2,
            'w' => max(1.0, $slot[2] * $cw - $g),
            'h' => max(1.0, $slot[3] * $ch - $g),
        ];
    }
}
