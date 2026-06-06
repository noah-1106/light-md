const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const CORNER = 200;
const BG_COLOR = '#FFFFFF';
const ACCENT = '#0066FF';

// SVG icon: rounded rect with letter L
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}" fill="${BG_COLOR}"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
    font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
    font-size="640" font-weight="700" fill="${ACCENT}" letter-spacing="-20">L</text>
</svg>
`;

async function main() {
  const iconsDir = path.join(__dirname, '../src-tauri/icons');

  // Ensure directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  // Generate base PNG from SVG
  const basePng = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  // Save 32x32
  await sharp(basePng)
    .resize(32, 32)
    .png()
    .toFile(path.join(iconsDir, '32x32.png'));

  // Save 128x128
  await sharp(basePng)
    .resize(128, 128)
    .png()
    .toFile(path.join(iconsDir, '128x128.png'));

  // Save 128x128@2x (256x256)
  await sharp(basePng)
    .resize(256, 256)
    .png()
    .toFile(path.join(iconsDir, '128x128@2x.png'));

  // Save icon.png (source)
  await sharp(basePng)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon.png'));

  // Generate .icns using sips + iconutil
  const iconsetDir = path.join(iconsDir, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }

  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of sizes) {
    await sharp(basePng)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetDir, name));
  }

  // Convert to icns
  const { execSync } = require('child_process');
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(iconsDir, 'icon.icns')}"`);
    console.log('Generated icon.icns');
  } catch (e) {
    console.error('iconutil failed:', e.message);
  }

  // Clean up iconset
  fs.rmSync(iconsetDir, { recursive: true, force: true });

  // Generate .ico for Windows
  try {
    execSync(`sips -s format ico "${path.join(iconsDir, 'icon.png')}" --out "${path.join(iconsDir, 'icon.ico')}"`);
    console.log('Generated icon.ico');
  } catch (e) {
    console.error('sips ico failed:', e.message);
  }

  console.log('All icons generated!');
}

main().catch(console.error);
