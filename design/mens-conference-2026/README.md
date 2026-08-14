# Men's Conference 2026 Poster

Theme: **Building Men, Rebuilding Nations**

## Confirmed information

- Date: Saturday, 26 September 2026
- Venue: Mampurut Hall
- Host: Pastor T. Ngwenya
- Information contact: Pastor Joseph Majila — 084 409 5904
- Social handle: `@renewedlifeint`
- Platforms: TikTok, Facebook, Instagram and YouTube
- Four speaker positions are intentionally marked “To Be Announced”.
- Topics: Ungazibulali Ndoda; Biblical Fatherhood; Mental Wellness;
  Financial Wellness; and many more.

## Outputs

- `final/building-men-rebuilding-nations-high-res-2160x2700.png`
- `final/building-men-rebuilding-nations-social-1080x1350.png`
- `final/building-men-rebuilding-nations-social-1080x1350.jpg`

## Five additional design variations

The `variations/final/` folder contains social and high-resolution exports for:

1. Forged Steel
2. Blueprint Builders
3. Ivory Editorial
4. Royal Midnight
5. Sunrise Foundations

Run `node design/mens-conference-2026/generate-five-variations.mjs` to
regenerate the full set and its comparison contact sheet.

## Updating speakers later

The four speaker cards are defined by the `silhouette()` function in
`generate-poster.mjs`. Replace each placeholder group with a transparent speaker
portrait and speaker-name text, then run:

```bash
node design/mens-conference-2026/generate-poster.mjs
```

The campaign keeps its generated image sources under `assets/` so later poster
revisions do not depend on temporary generated-image storage.
