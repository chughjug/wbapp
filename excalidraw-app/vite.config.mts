import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgrPlugin from "vite-plugin-svgr";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import { VitePWA } from "vite-plugin-pwa";
import checker from "vite-plugin-checker";
import { createHtmlPlugin } from "vite-plugin-html";
import Sitemap from "vite-plugin-sitemap";
import { woff2BrowserPlugin } from "../scripts/woff2/woff2-vite-plugins";

import {
  SHARE_SW_FILE_NAME,
  SHARE_SW_URL,
  SHARE_TARGET_MANIFEST,
} from "./goodnotes/share-target/constants";
import { shareTargetSwPlugin } from "./goodnotes/share-target/vitePlugin";

import { MERMAID_CHUNKS_LIST_NAME } from "./data/cacheMermaidChunks";

import type { Plugin, Rollup } from "vite";

/**
 * Collects into `lazyChunkFileNames` the chunks reachable only via a dynamic
 * import of a module matching `moduleRegex`, so we can exclude them from the
 * PWA precache. Needed for large lazy deps that Rollup splits into many
 * arbitrarily named chunks (e.g. mermaid), which `globIgnores` can't target.
 *
 * With `listName`, their file names are also emitted as a JSON asset that
 * index.html points to (`<meta name={listName} content={fileName}>`), for the
 * app to cache them when it needs them.
 */
const lazyChunksPlugin = (
  moduleRegex: RegExp,
  lazyChunkFileNames: Set<string>,
  listName?: string,
): Plugin => ({
  name: "excalidraw-lazy-chunks",
  apply: "build",
  generateBundle(_options, bundle) {
    const chunks = new Map<string, Rollup.OutputChunk>();
    for (const file of Object.values(bundle)) {
      if (file.type === "chunk") {
        chunks.set(file.fileName, file);
      }
    }

    // the dynamically imported module may share its chunk with its deps
    // (no `facadeModuleId` then), so match on any contained module
    const isLazyRoot = (chunk: Rollup.OutputChunk) =>
      chunk.isDynamicEntry &&
      !chunk.isEntry &&
      chunk.moduleIds.some((id) => moduleRegex.test(id));

    const collectReachable = (
      roots: Rollup.OutputChunk[],
      skipDynamicImport: (chunk: Rollup.OutputChunk) => boolean,
    ) => {
      const reachable = new Set<string>();
      const stack = [...roots];
      while (stack.length) {
        const chunk = stack.pop()!;
        if (reachable.has(chunk.fileName)) {
          continue;
        }
        reachable.add(chunk.fileName);
        // static imports are always followed: they're needed whenever the
        // importing chunk is loaded
        for (const fileName of chunk.imports) {
          const next = chunks.get(fileName);
          if (next) {
            stack.push(next);
          }
        }
        for (const fileName of chunk.dynamicImports) {
          const next = chunks.get(fileName);
          if (next && !skipDynamicImport(next)) {
            stack.push(next);
          }
        }
      }
      return reachable;
    };

    const lazyRoots = [...chunks.values()].filter(isLazyRoot);
    if (!lazyRoots.length) {
      this.warn(`no lazy-loaded chunk found for ${moduleRegex}`);
    }

    // anything also reachable without dynamically importing the lazy roots
    // (e.g. deps shared with the main bundle, or a lazy root that Rollup
    // merged into a statically imported chunk) must stay precached
    const reachableOtherwise = collectReachable(
      [...chunks.values()].filter((chunk) => chunk.isEntry),
      isLazyRoot,
    );

    for (const chunk of lazyRoots) {
      if (reachableOtherwise.has(chunk.fileName)) {
        this.warn(
          `${chunk.fileName} (matching ${moduleRegex}) is reachable without a dynamic import, so it's not lazy-loaded and stays precached`,
        );
      }
    }

    lazyChunkFileNames.clear();
    for (const fileName of collectReachable(lazyRoots, () => false)) {
      if (!reachableOtherwise.has(fileName)) {
        lazyChunkFileNames.add(fileName);
      }
    }

    if (listName) {
      this.emitFile({
        type: "asset",
        name: `${listName}.json`,
        source: JSON.stringify([...lazyChunkFileNames]),
      });
    }
  },
  // "post" handlers run in Vite's HTML plugin's `generateBundle`, after ours
  transformIndexHtml: {
    order: "post",
    handler: (_html, { bundle }) => {
      if (!listName) {
        return;
      }
      const list = Object.values(bundle ?? {}).find(
        (file) => file.type === "asset" && file.name === `${listName}.json`,
      );
      if (!list) {
        throw new Error(`${listName}.json wasn't emitted`);
      }
      return [
        {
          tag: "meta",
          attrs: { name: listName, content: list.fileName },
          injectTo: "head",
        },
      ];
    },
  },
});

export default defineConfig(({ mode }) => {
  // To load .env variables
  const envVars = loadEnv(mode, `../`);
  // mermaid (+ its many deps & per-diagram chunks) is lazy-loaded and large,
  // so we don't precache it (the app caches it once the TTD dialog is opened,
  // see `cacheMermaidChunks`). Populated at build time by `lazyChunksPlugin`.
  const mermaidChunkFileNames = new Set<string>();
  // MathJax is ~1.6MB of typesetting code and glyph outlines, nearly all of
  // it the SVG font. It is loaded the first time an equation is inserted or
  // edited, and most notebooks never hold one — precaching it would put
  // that on every first visit, including every phone on a hotspot. It is
  // excluded from the precache and picked up instead by the `lazy-chunks`
  // runtime rule below, so a student who does use equations has them
  // offline from the second time onwards.
  const mathjaxChunkFileNames = new Set<string>();
  // https://vitejs.dev/config/
  return {
    server: {
      port: Number(envVars.VITE_APP_PORT || 3000),
      // open the browser
      open: true,
    },
    // ink-stroke-modeler-ts ships TypeScript source (no prebuilt JS)
    optimizeDeps: {
      include: ["ink-stroke-modeler-ts"],
      esbuildOptions: {
        loader: {
          ".ts": "ts",
        },
      },
    },
    // We need to specify the envDir since now there are no
    //more located in parallel with the vite.config.ts file but in parent dir
    envDir: "../",
    resolve: {
      alias: [
        {
          find: /^@excalidraw\/common$/,
          replacement: path.resolve(
            __dirname,
            "../packages/common/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/common\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/common/src/$1"),
        },
        {
          find: /^@excalidraw\/element$/,
          replacement: path.resolve(
            __dirname,
            "../packages/element/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/element\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/element/src/$1"),
        },
        {
          find: /^@excalidraw\/excalidraw$/,
          replacement: path.resolve(
            __dirname,
            "../packages/excalidraw/index.tsx",
          ),
        },
        {
          find: /^@excalidraw\/excalidraw\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/excalidraw/$1"),
        },
        {
          find: /^@excalidraw\/math$/,
          replacement: path.resolve(__dirname, "../packages/math/src/index.ts"),
        },
        {
          find: /^@excalidraw\/math\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/math/src/$1"),
        },
        {
          find: /^@excalidraw\/utils$/,
          replacement: path.resolve(
            __dirname,
            "../packages/utils/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/utils\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/utils/src/$1"),
        },
        {
          find: /^@excalidraw\/fractional-indexing$/,
          replacement: path.resolve(
            __dirname,
            "../packages/fractional-indexing/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/laser-pointer$/,
          replacement: path.resolve(
            __dirname,
            "../packages/laser-pointer/src/index.ts",
          ),
        },
      ],
    },
    build: {
      outDir: "build",
      rollupOptions: {
        output: {
          assetFileNames(chunkInfo) {
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }

            return "assets/[name]-[hash][extname]";
          },
          // Creating separate chunk for locales except for en and percentages.json so they
          // can be cached at runtime and not merged with
          // app precache. en.json and percentages.json are needed for first load
          // or fallback hence not clubbing with locales so first load followed by offline mode works fine. This is how CRA used to work too.
          manualChunks(id) {
            // Bundler runtime helpers (dynamic import preloading, CJS interop)
            // would otherwise live in the main bundle, and every lazy chunk
            // importing them would get a new file name with each deploy. Tabs
            // still running the previous version would then fail to load
            // non-precached lazy chunks (e.g. mermaid) after a deploy.
            if (
              id === "\0vite/preload-helper.js" ||
              id === "\0commonjsHelpers.js"
            ) {
              return "bundler-helpers";
            }

            if (
              id.includes("packages/excalidraw/locales") &&
              id.match(/en.json|percentages.json/) === null
            ) {
              const index = id.indexOf("locales/");
              // Taking the substring after "locales/"
              return `locales/${id.substring(index + 8)}`;
            }

            if (id.includes("@codemirror/") || id.includes("@lezer/")) {
              return "codemirror.chunk";
            }
          },
        },
      },
      sourcemap: true,
      // don't auto-inline small assets (i.e. fonts hosted on CDN)
      assetsInlineLimit: 0,
    },
    plugins: [
      Sitemap({
        hostname: "https://excalidraw.com",
        outDir: "build",
        changefreq: "monthly",
        // its static in public folder
        generateRobotsTxt: false,
      }),
      woff2BrowserPlugin(),
      lazyChunksPlugin(
        /[\\/]node_modules[\\/]@excalidraw[\\/]mermaid-to-excalidraw[\\/]/,
        mermaidChunkFileNames,
        MERMAID_CHUNKS_LIST_NAME,
      ),
      lazyChunksPlugin(
        /[\\/]node_modules[\\/]mathjax-full[\\/]/,
        mathjaxChunkFileNames,
      ),
      react(),
      checker({
        typescript: true,
        eslint:
          envVars.VITE_APP_ENABLE_ESLINT === "false"
            ? undefined
            : {
                // The glob is relative to this package, and eslint looks for
                // `.eslintignore` relative to the cwd it runs in — which is
                // here, not the repo root, so the root file's `build/` entry
                // never applies. Without these the dev server lints its own
                // production output, and `yarn build` kills a running
                // `yarn dev`: the checker expands the glob, the build rewrites
                // `build/assets/<hash>.js`, and the next read dies with ENOENT
                // on a filename that no longer exists.
                lintCommand:
                  'eslint "./**/*.{js,ts,tsx}" --ignore-pattern build --ignore-pattern dist --ignore-pattern dev-dist',
              },
        overlay: {
          initialIsOpen: envVars.VITE_APP_COLLAPSE_OVERLAY === "false",
          badgeStyle: "margin-bottom: 4rem; margin-left: 1rem",
        },
      }),
      svgrPlugin(),
      ViteEjsPlugin(),
      shareTargetSwPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          /* set this flag to true to enable in Development mode */
          enabled: envVars.VITE_APP_ENABLE_PWA === "true",
        },

        workbox: {
          // don't precache fonts, locales and separate chunks
          globIgnores: [
            "fonts.css",
            "**/locales/**",
            "service-worker.js",
            "**/*.chunk-*.js",
            // CodeMirrorEditor can't be assigned a `.chunk` name via
            // manualChunks because Rollup would hoist shared deps (React)
            // via a static import from the main bundle, defeating lazy
            // loading. So we exclude it by name instead.
            "**/CodeMirrorEditor-*.js",
            // lazy-loaded Firebase SDK, only needed for collab/sharing, which
            // require network anyway
            "**/firebaseSDK-*.js",
            // the share-target handler: the service worker already pulls it
            // in with `importScripts` (which the browser stores alongside the
            // SW script), so precaching a second, separately-versioned copy
            // would only risk serving a stale one
            SHARE_SW_FILE_NAME,
          ],
          // mermaid and MathJax chunks are excluded here rather than via
          // `globIgnores` as their file names are arbitrary
          manifestTransforms: [
            (entries) => ({
              manifest: entries.filter(
                (entry) =>
                  !mermaidChunkFileNames.has(entry.url) &&
                  !mathjaxChunkFileNames.has(entry.url),
              ),
              warnings: [],
            }),
          ],
          // Our own `fetch` listener for the share-target POST. workbox's
          // `generateSW` has no hook for a custom route, but it emits
          // `importScripts(...)` at the very top of the generated SW, so this
          // listener is registered *before* workbox's router and gets first
          // refusal on the request. The file is produced by
          // `shareTargetSwPlugin` (build) / its dev middleware.
          importScripts: [SHARE_SW_URL],
          // NOTE — deliberately no `navigateFallbackDenylist` entry for
          // `/share-target`. The POST never reaches workbox's NavigationRoute
          // (that route only matches GET), while the GET that follows the
          // SW's 303 redirect *must* be served `index.html` so the SPA can
          // render the receive screen. Denylisting the path would send that
          // GET to the static host, which has no such file.
          runtimeCaching: [
            {
              urlPattern: new RegExp(".+.woff2"),
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
                },
                cacheableResponse: {
                  // 0 to cache "opaque" responses from cross-origin requests (i.e. CDN)
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: new RegExp("fonts.css"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50,
                },
              },
            },
            {
              urlPattern: new RegExp("locales/[^/]+.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "locales",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // <== 30 days
                },
              },
            },
            {
              urlPattern: new RegExp("(.chunk-.+|CodeMirrorEditor-.+)\\.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "chunk",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // <== 90 days
                },
              },
            },
            {
              urlPattern: new RegExp("/assets/[^/]+\\.js$"),
              handler: "CacheFirst",
              options: {
                cacheName: "lazy-chunks",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // <== 90 days
                },
              },
            },
          ],
          // 6MB: the GoodNotes layer (pdf.js, jsPDF) pushes the entry chunk
          // past the old 2.3MB ceiling, and exceeding it fails the build
          // rather than just skipping precache for that file.
          maximumFileSizeToCacheInBytes: 6 * 1024 ** 2,
        },
        manifest: {
          short_name: "Notebook",
          name: "Notebook",
          description:
            "Notebook is a note-taking app for handwritten notes, sketches and annotated documents.",
          icons: [
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "apple-touch-icon.png",
              type: "image/png",
              sizes: "180x180",
            },
            {
              src: "favicon-32x32.png",
              sizes: "32x32",
              type: "image/png",
            },
            {
              src: "favicon-16x16.png",
              sizes: "16x16",
              type: "image/png",
            },
          ],
          start_url: "/",
          id: "notebook",
          display: "standalone",
          theme_color: "#121212",
          background_color: "#ffffff",
          file_handlers: [
            {
              action: "/",
              accept: {
                "application/vnd.excalidraw+json": [".excalidraw"],
              },
            },
          ],
          // Receive a PDF from the OS share sheet and open it as an
          // annotatable document. Handled by the service worker (see
          // `importScripts` above) and by the `/share-target` route in the
          // app; `goodnotes/share-target/constants.ts` is the single source
          // of truth shared by all three.
          //
          // Works on installed Chromium PWAs on Android/ChromeOS only —
          // WebKit does not implement Web Share Target, so no iOS browser
          // can offer this. The in-app file picker and drag-and-drop cover
          // every platform; see goodnotes/share-target/INTEGRATION.md.
          //
          // Replaces the former `/web-share-target` + `.excalidraw` entry:
          // nothing in this fork served that route (the SW had no POST
          // handler, and `/` renders the document shelf rather than the
          // editor that reads upstream's `web-share-target` cache), so it
          // advertised a capability the app did not have.
          share_target: SHARE_TARGET_MANIFEST,
          // Real captures of this app. The six that were here before
          // ("virtual-whiteboard", "wireframe", "illustration", "shapes",
          // "collaboration", "export") were upstream Excalidraw's marketing
          // shots, so the install prompt previewed a different product.
          // `form_factor` is what lets a store/prompt pick the right one.
          screenshots: [
            {
              src: "/screenshots/library-wide.png",
              type: "image/png",
              sizes: "1194x834",
              form_factor: "wide",
              label: "Your notebooks on the shelf",
            },
            {
              src: "/screenshots/notebook-page.png",
              type: "image/png",
              sizes: "462x945",
              form_factor: "narrow",
              label: "Handwriting on a ruled page",
            },
            {
              src: "/screenshots/library.png",
              type: "image/png",
              sizes: "462x945",
              form_factor: "narrow",
              label: "Your notebooks on the shelf",
            },
          ],
        },
      }),
      createHtmlPlugin({
        minify: true,
      }),
    ],
    publicDir: "../public",
  };
});
