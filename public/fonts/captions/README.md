# Caption fonts

Unmodified fonts shared by browser CSS and the server renderer. No system font dependency.

- DejaVu 2.37: https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37 (Sans, Sans Condensed, Serif; four styles each).
- Liberation Sans 2.1.5: Debian fonts-liberation2_2.1.5-1_all.deb, https://deb.debian.org/debian/pool/main/f/fonts-liberation2/ .
- Redistribution licenses: LICENSE-DejaVu.txt and LICENSE-Liberation.txt.

Files retain upstream family names and complete glyph coverage. Browser weights 100–500 select Regular, 600–900 select Bold, matching the worker's static-font selection. Both upright and italic styles are supplied; CSS synthetic weight/style is disabled on Studio captions. Browser downloads only faces needed on a page. Deployment must include this public directory; missing assets fail rendering rather than quietly substituting OS fonts.

## SHA-256

e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724  DejaVuSans-Bold.ttf
eb436dca0c2594b73d8b603b892e374fdfd8d885d25ffb4f18df4c4c0b49e50f  DejaVuSans-BoldOblique.ttf
4af75fa16ee6d3ad43e1ecec41862c24954af26a55c6bb1ebb27bd486a50f5f4  DejaVuSans-Oblique.ttf
7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954  DejaVuSans.ttf
38098d0b8edd8430a0f53fb2831b5d36037563a998a620d3c87a4d7591766d20  DejaVuSansCondensed-Bold.ttf
43f9fd6b77edf174553cf94857c77c63de7ddb0c6751fd1390e73223518e128f  DejaVuSansCondensed-BoldOblique.ttf
dc3526fa25fae4278c4e34b47d4c049b6923421c70921032a0db11bfe9c1b0cf  DejaVuSansCondensed-Oblique.ttf
8550cd5ca1acb65a8fc7877c46939cd0b4d909f8e7bc1e24716873d918c5e549  DejaVuSansCondensed.ttf
c47b5527bcdc8dcf9ea8c77054454c5a884beaca2f44851a2a823ee639cbf07f  DejaVuSerif-Bold.ttf
8d3dd3d31350309042ed226af82b34539bd773518e6107cb352712853ba80308  DejaVuSerif-BoldItalic.ttf
2e39b1d50f90b933b00c7bb54a96afd3f86419b3d717c7cf202e36f2d4973e47  DejaVuSerif-Italic.ttf
42d1edeb7952f31b1f96d767ed7030b08a39e0c372b0071641518864e2bffb51  DejaVuSerif.ttf
ba0e0dc3f7aca5b0afbc31e800531ee43be3aa79ae35b2ef1f6470a9547765c4  LiberationSans-Bold.ttf
15c1068175252e4adee6d3721bf74064ffe437f679d9dbaeacd03fa7711a041b  LiberationSans-BoldItalic.ttf
01f559e5c501d3d5777647c6a92b3ff37a4523bcf4f3b6e97ae052af567618b1  LiberationSans-Italic.ttf
8d91388f1d3604b3b8ae0e3ee2d140e50cd6122f9214514f4aca772540a4076d  LiberationSans-Regular.ttf
