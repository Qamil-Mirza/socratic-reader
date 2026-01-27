import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Plugin to copy static files after build
function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      
      // Ensure directories exist
      if (!existsSync(resolve(dist, 'popup'))) {
        mkdirSync(resolve(dist, 'popup'), { recursive: true });
      }
      if (!existsSync(resolve(dist, 'options'))) {
        mkdirSync(resolve(dist, 'options'), { recursive: true });
      }
      if (!existsSync(resolve(dist, 'icons'))) {
        mkdirSync(resolve(dist, 'icons'), { recursive: true });
      }
      
      // Copy manifest
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(dist, 'manifest.json')
      );
      
      // Copy HTML files
      copyFileSync(
        resolve(__dirname, 'src/popup/popup.html'),
        resolve(dist, 'popup/popup.html')
      );
      copyFileSync(
        resolve(__dirname, 'src/options/options.html'),
        resolve(dist, 'options/options.html')
      );
      
      // Copy CSS
      copyFileSync(
        resolve(__dirname, 'src/styles.css'),
        resolve(dist, 'styles.css')
      );
      
      // Copy icons if they exist
      const iconsDir = resolve(__dirname, 'public/icons');
      if (existsSync(iconsDir)) {
        try {
          const icons = readdirSync(iconsDir);
          for (const icon of icons) {
            if (icon.endsWith('.png') || icon.endsWith('.svg')) {
              copyFileSync(
                resolve(iconsDir, icon),
                resolve(dist, 'icons', icon)
              );
            }
          }
        } catch {
          // Icons directory may be empty or not exist
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'options/options': resolve(__dirname, 'src/options/options.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  plugins: [copyStaticFiles()],
  publicDir: false, // We handle copying manually
});
