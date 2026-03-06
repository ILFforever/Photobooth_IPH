import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from src-tauri/src/version.rs (single source of truth)
const versionRsContent = readFileSync(join(__dirname, 'src-tauri', 'src', 'version.rs'), 'utf-8');
const versionMatch = versionRsContent.match(/pub const APP_VERSION: &str = "([^"]+)"/);
const APP_VERSION = versionMatch ? versionMatch[1] : '1.0.11';

// Ensure dist directory exists
mkdirSync(join(__dirname, 'dist'), { recursive: true });
mkdirSync(join(__dirname, 'dist', 'src', 'assets', 'images'), { recursive: true });

// Read splash.html and inject version metadata
let splashContent = readFileSync(join(__dirname, 'splash.html'), 'utf-8');
splashContent = splashContent.replace(/Version Loading\.\.\./g, `Version ${APP_VERSION}`);
splashContent = splashContent.replace(/data-version="[^"]*"/g, `data-version="${APP_VERSION}"`);

// Write modified splash.html to dist
const splashDest = join(__dirname, 'dist', 'splash.html');
writeFileSync(splashDest, splashContent);

// Copy IPH.png to dist
const logoSource = join(__dirname, 'src', 'assets', 'images', 'IPH.png');
const logoDest = join(__dirname, 'dist', 'src', 'assets', 'images', 'IPH.png');

if (existsSync(logoSource)) {
  copyFileSync(logoSource, logoDest);
  logger.debug('Copied IPH.png to dist/src/assets/images/');
} else {
  logger.debug('IPH.png not found, skipping...');
}
