import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import { usersIcon, share } from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import { ExportDialog, getOrderedPageFrames } from "./goodnotes/export";
import { NavBar, PagePanel } from "./goodnotes/shell";
import { TabBar, useOpenDocs } from "./goodnotes/tabs";
import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
import { ObjectMenu } from "./goodnotes/object-menu";
import { useGraphDialog } from "./goodnotes/graph";
import { useInputGestures } from "./goodnotes/input";
import { useSettingsScreen } from "./goodnotes/settings";
import {
  GlobalPdfDropOverlay,
  PdfDropZone,
  ShareTargetReceiver,
  isShareTargetUrl,
} from "./goodnotes/share-target";
import { useDarkMode } from "./goodnotes/dark";
import { ImportPdfDialog } from "./goodnotes/import-pdf";
import {
  FuzzySelectOverlay,
  toggleFuzzySelect,
  deactivateFuzzySelect,
  useFuzzySelectActive,
} from "./goodnotes/fuzzy-select";
import { BackdropPanel, useBackdropPanel } from "./goodnotes/backdrops";
import {
  usePages,
  useNewPage,
  isPageFrame,
  getPageTemplate,
} from "./goodnotes/pages";
import { PaperBackgroundLayer } from "./goodnotes/paper";
import { PagedViewControls, usePagedView } from "./goodnotes/paged";
import { Dashboard } from "./goodnotes/dashboard";
import { CourseBrowser, useCanvasConnect } from "./goodnotes/canvas";
import {
  createDoc,
  getScene,
  saveSceneDebounced,
  flushSceneSaves,
} from "./goodnotes/library";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
  userToFollowAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { AppSidebar } from "./components/AppSidebar";

import type { DocMeta } from "./goodnotes/types";

import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = ({
  docId,
  onCloseDocument,
  onNewDocument,
}: {
  /** null for a transient scene (shared `#room=` / `#json=` link). */
  docId: string | null;
  onCloseDocument: () => void;
  onNewDocument: () => void;
}) => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const [isPdfExportOpen, setIsPdfExportOpen] = useState(false);
  const [isPdfImportOpen, setIsPdfImportOpen] = useState(false);
  const isFuzzySelectActive = useFuzzySelectActive();
  const backdrops = useBackdropPanel(excalidrawAPI);
  // view transform mirrored out of AppState so the paper layer, which lives
  // outside the editor, can follow the canvas
  const [paperView, setPaperView] = useState({
    elements: [] as readonly OrderedExcalidrawElement[],
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    theme: "light" as "light" | "dark",
    offsetLeft: 0,
    offsetTop: 0,
  });

  const { seedFirstPage, pages } = usePages(excalidrawAPI);
  const toolMenu = useActiveToolMenu({ excalidrawAPI });
  // palm rejection, page flick and tap gestures go live from here
  const input = useInputGestures(excalidrawAPI);
  const graph = useGraphDialog(excalidrawAPI);
  // one page at a time, fitted to the workspace; swipe/arrows move between
  const paged = usePagedView(excalidrawAPI);
  const [isPagePanelOpen, setIsPagePanelOpen] = useState(true);
  const openDocs = useOpenDocs(docId ?? undefined);

  const onActivateTab = useCallback(
    (id: string) => {
      window.history.pushState({}, "", `/d/${encodeURIComponent(id)}`);
      openDocs.actions.activate(id);
      // the editor is keyed on docId, so navigating remounts it
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [openDocs.actions],
  );

  const onCloseTab = useCallback(
    (id: string) => {
      openDocs.actions.close(id);
    },
    [openDocs.actions],
  );

  // 1-based page under the viewport centre, for the export dialog's
  // "current page" option. Keyed off `paperView` so it tracks scrolling.
  const currentPageNumber = useMemo(() => {
    if (!excalidrawAPI) {
      return null;
    }
    const { scrollY, height } = excalidrawAPI.getAppState();
    const centreY = -scrollY + height / 2;
    const frames = getOrderedPageFrames(paperView.elements);
    const index = frames.findIndex(
      (frame) => centreY >= frame.y && centreY <= frame.y + frame.height,
    );
    return index === -1 ? null : index + 1;
  }, [excalidrawAPI, paperView]);

  // every new document starts with one page, so the canvas is never an
  // unbounded void; idempotent, so reopening a document does not add pages.
  //
  // A transient scene (`docId === null`) is deliberately excluded: it is
  // somebody else's `#room=` session or an imported `#json=` drawing, not a
  // notebook in this user's library. Seeding there would inject a `page:1`
  // frame into a scene we do not own — and in a live room that frame would
  // be synced straight into every other participant's canvas.
  useEffect(() => {
    if (!excalidrawAPI || !docId) {
      return;
    }
    initialStatePromiseRef.current.promise.then(() => {
      seedFirstPage({ size: "LETTER", template: "lined" });
    });
  }, [excalidrawAPI, docId, seedFirstPage]);

  // flush any debounced scene write before the tab goes away
  useEffect(() => {
    const flush = () => void flushSceneSaves();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const { editorTheme, appTheme, setAppTheme } = useDarkMode();
  const settings = useSettingsScreen({
    theme: editorTheme,
    // a restore writes straight to IndexedDB, which the library's in-process
    // listeners never see, so re-reading the whole app is the honest answer
    onRestored: () => window.location.reload(),
  });
  // one shared new-page dialog, used by both the nav bar and the page panel
  const newPage = useNewPage(excalidrawAPI, {
    docId: docId ?? undefined,
    theme: editorTheme,
  });

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);
  const userToFollow = useAtomValue(userToFollowAtom);

  const viewportStatusFrame = useMemo(
    () =>
      userToFollow
        ? {
            border: "var(--color-primary-hover)",
            label: {
              label: (
                <>
                  Following{" "}
                  <span
                    style={{
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 100,
                    }}
                    title={userToFollow.username}
                  >
                    {userToFollow.username}
                  </span>
                </>
              ),
              onClose: () => collabAPI?.setUserToFollow(null),
            },
          }
        : null,
    [userToFollow, collabAPI],
  );

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(excalidrawAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      // Prefer this document's own scene from the library. Falling back to
      // `data.scene` keeps the usual defaults and the `#json=` import path
      // working for a document that has never been saved.
      const docScene = docId ? await getScene(docId) : null;
      initialStatePromiseRef.current.promise.resolve(
        docScene
          ? {
              elements: docScene.elements,
              appState: {
                ...docScene.appState,
                // the paper layer sits behind Excalidraw's canvas, which
                // paints over it unless the background is literally
                // "transparent"
                viewBackgroundColor: "transparent",
              },
              files: docScene.files,
            }
          : {
              ...data.scene,
              appState: {
                ...data.scene?.appState,
                viewBackgroundColor: "transparent",
              },
            },
      );
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    loadImages,
    docId,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // persist into this document's own record; coalesced per document.
    // A transient scene has none, and stays on upstream's LocalData.
    if (docId) {
      saveSceneDebounced(docId, { elements, appState, files });
    }

    // keep the paper layer in step with the canvas; bail out to the previous
    // object when nothing it cares about moved, so this hot path does not
    // re-render the layer on every pointer event
    setPaperView((prev) =>
      prev.elements === elements &&
      prev.scrollX === appState.scrollX &&
      prev.scrollY === appState.scrollY &&
      prev.zoom === appState.zoom.value &&
      prev.theme === appState.theme &&
      prev.offsetLeft === appState.offsetLeft &&
      prev.offsetTop === appState.offsetTop
        ? prev
        : {
            elements,
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom.value,
            theme: appState.theme,
            offsetLeft: appState.offsetLeft,
            offsetTop: appState.offsetTop,
          },
    );

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const isCollabAvailable =
    !isCollabDisabled && (!isOffline || isCollaborating);

  useEffect(() => {
    if (!isCollabAvailable) {
      setShareDialogState({ isOpen: false });
    }
  }, [isCollabAvailable, setShareDialogState]);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <div
      style={{ height: "100%", position: "relative" }}
      className={clsx("excalidraw-app", "gn-shell-layout", {
        "is-collaborating": isCollaborating,
      })}
    >
      {/* band 1 — document tabs */}
      <TabBar
        tabs={openDocs.tabs}
        activeId={openDocs.activeId}
        theme={editorTheme}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onReorder={openDocs.actions.reorder}
        onCloseOthers={openDocs.actions.closeOthers}
        onNewTab={onNewDocument}
      />
      {/* band 2 — the one nav bar */}
      <NavBar
        excalidrawAPI={excalidrawAPI}
        suppressDefaultChrome
        theme={editorTheme}
        onHome={onCloseDocument}
        onNewDocument={onNewDocument}
        pagePanelOpen={isPagePanelOpen}
        onTogglePagePanel={() => setIsPagePanelOpen((v) => !v)}
        // the bar knows more tools than the menu has panels for
        onActiveToolMenu={(tool, anchor) => {
          if (
            tool === "pen" ||
            tool === "highlighter" ||
            tool === "eraser" ||
            tool === "shape" ||
            tool === "text"
          ) {
            toolMenu.onToolSelect(tool, anchor);
          }
        }}
        onFuzzySelect={() => {
          backdrops.close();
          toggleFuzzySelect();
        }}
        fuzzySelectActive={isFuzzySelectActive}
        onImportPdf={() => {
          deactivateFuzzySelect();
          setIsPdfImportOpen(true);
        }}
        onExportPdf={() => {
          deactivateFuzzySelect();
          setIsPdfExportOpen(true);
        }}
        onOpenBackdrops={() => {
          // the lasso overlay is modal and covers the window
          deactivateFuzzySelect();
          backdrops.open();
        }}
        backdropsActive={backdrops.isOpen}
        backdropsDisabled={!backdrops.hasImageSelection}
        onUndo={input.undo}
        onRedo={input.redo}
        onAddPage={newPage.open}
        pageCount={pages.length}
        currentPage={currentPageNumber ?? undefined}
        moreItems={[
          {
            id: "insert-graph",
            label: "Insert graph…",
            onSelect: () => graph.open(),
          },
          {
            id: "settings",
            label: "Settings…",
            onSelect: () => settings.open(),
          },
        ]}
      />
      {/* band 3 — page panel + canvas */}
      {/* the active tool's settings, docked as a band under the bar */}
      <ToolMenu {...toolMenu.menuProps} />
      <div className="gn-shell-body">
        <PagePanel
          open={isPagePanelOpen}
          onClose={() => setIsPagePanelOpen(false)}
          theme={editorTheme}
          excalidrawAPI={excalidrawAPI}
          onAddPage={newPage.open}
          docId={docId ?? undefined}
        />
        <div className="gn-shell-canvas">
          <PaperBackgroundLayer
            elements={paperView.elements}
            scrollX={paperView.scrollX}
            scrollY={paperView.scrollY}
            zoom={paperView.zoom}
            theme={paperView.theme}
            // The layer is a sibling of <Excalidraw> inside .gn-shell-canvas,
            // so it already shares the editor canvas's box.
            // appState.offsetLeft/Top measure that box from the VIEWPORT, so
            // passing them here shifts the paper a second time.
            offsetLeft={0}
            offsetTop={0}
            // Resolve by frame id, not by `page.index`: the paper module derives
            // that index from the frame NAME (so "page:1" gives 1), while the
            // pages module's index accessors are 0-based array positions. Going
            // through the id sidesteps the mismatch entirely.
            templateForPage={(page) => {
              const frame = paperView.elements.find((el) => el.id === page.id);
              return frame && isPageFrame(frame)
                ? getPageTemplate(frame)
                : undefined;
            }}
          />
          <Excalidraw
            viewportStatusFrame={viewportStatusFrame}
            userToFollow={userToFollow}
            onChange={onChange}
            onExport={onExport}
            initialData={initialStatePromiseRef.current.promise}
            isCollaborating={isCollaborating}
            onPointerUpdate={collabAPI?.onPointerUpdate}
            UIOptions={{
              canvasActions: {
                toggleTheme: true,
                export: {
                  onExportToBackend,
                },
              },
            }}
            langCode={langCode}
            renderCustomStats={renderCustomStats}
            detectScroll={false}
            handleKeyboardGlobally={true}
            autoFocus={true}
            theme={editorTheme}
            // Dark mode is a VIEWING mode. Without this the editor mirrors the
            // view theme into appState.exportWithDarkMode and every exported
            // PNG/SVG — and so every submitted PDF — comes out black.
            exportTheme="light"
            onThemeChange={setAppTheme}
            renderTopRightUI={(isMobile) => {
              if (isMobile || !collabAPI || !isCollabAvailable) {
                return null;
              }

              return (
                <div className="excalidraw-ui-top-right">
                  {collabError.message && (
                    <CollabError collabError={collabError} />
                  )}
                  <LiveCollaborationTrigger
                    isCollaborating={isCollaborating}
                    onSelect={() =>
                      setShareDialogState({ isOpen: true, type: "share" })
                    }
                    editorInterface={editorInterface}
                  />
                </div>
              );
            }}
            onLinkOpen={(element, event) => {
              if (element.link && isElementLink(element.link)) {
                event.preventDefault();
                excalidrawAPI?.setViewport({
                  target: element.link,
                  fit: "scale-down",
                  animation: true,
                });
              }
            }}
          >
            <AppMainMenu
              onCollabDialogOpen={onCollabDialogOpen}
              isCollaborating={isCollaborating}
              isCollabEnabled={isCollabAvailable}
              theme={appTheme}
              refresh={() => forceRefresh((prev) => !prev)}
              onExportPdf={() => setIsPdfExportOpen(true)}
              onCloseDocument={onCloseDocument}
            />
            <AppWelcomeScreen
              onCollabDialogOpen={onCollabDialogOpen}
              isCollabEnabled={isCollabAvailable}
            />
            <OverwriteConfirmDialog>
              <OverwriteConfirmDialog.Actions.ExportToImage />
              <OverwriteConfirmDialog.Actions.SaveToDisk />
            </OverwriteConfirmDialog>
            <AppFooter onChange={() => excalidrawAPI?.refresh()} />
            {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

            <TTDDialogTrigger />
            {isCollaborating && isOffline && (
              <div className="alertalert--warning">
                {t("alerts.collabOfflineWarning")}
              </div>
            )}
            {localStorageQuotaExceeded && (
              <div className="alert alert--danger">
                {t("alerts.localStorageQuotaExceeded")}
              </div>
            )}
            {latestShareableLink && (
              <ShareableLinkDialog
                link={latestShareableLink}
                onCloseRequest={() => setLatestShareableLink(null)}
                setErrorMessage={setErrorMessage}
              />
            )}
            {excalidrawAPI && !isCollabDisabled && (
              <Collab excalidrawAPI={excalidrawAPI} />
            )}

            <ShareDialog
              collabAPI={collabAPI}
              onExportToBackend={async () => {
                if (excalidrawAPI) {
                  try {
                    await onExportToBackend(
                      excalidrawAPI.getSceneElements(),
                      excalidrawAPI.getAppState(),
                      excalidrawAPI.getFiles(),
                    );
                  } catch (error: any) {
                    setErrorMessage(error.message);
                  }
                }
              }}
            />

            <AppSidebar />

            {errorMessage && (
              <ErrorDialog onClose={() => setErrorMessage("")}>
                {errorMessage}
              </ErrorDialog>
            )}

            <CommandPalette
              customCommandPaletteItems={[
                {
                  label: t("labels.liveCollaboration"),
                  category: DEFAULT_CATEGORIES.app,
                  predicate: isCollabAvailable,
                  keywords: [
                    "team",
                    "multiplayer",
                    "share",
                    "public",
                    "session",
                    "invite",
                  ],
                  icon: usersIcon,
                  perform: () => {
                    setShareDialogState({
                      isOpen: true,
                      type: "collaborationOnly",
                    });
                  },
                },
                {
                  label: t("roomDialog.button_stopSession"),
                  category: DEFAULT_CATEGORIES.app,
                  predicate: () => !!collabAPI?.isCollaborating(),
                  keywords: [
                    "stop",
                    "session",
                    "end",
                    "leave",
                    "close",
                    "exit",
                    "collaboration",
                  ],
                  perform: () => {
                    if (collabAPI) {
                      collabAPI.stopCollaboration();
                      if (!collabAPI.isCollaborating()) {
                        setShareDialogState({ isOpen: false });
                      }
                    }
                  },
                },
                {
                  label: t("labels.share"),
                  category: DEFAULT_CATEGORIES.app,
                  predicate: isCollabAvailable,
                  icon: share,
                  keywords: [
                    "link",
                    "shareable",
                    "readonly",
                    "export",
                    "publish",
                    "snapshot",
                    "url",
                    "collaborate",
                    "invite",
                  ],
                  perform: async () => {
                    setShareDialogState({ isOpen: true, type: "share" });
                  },
                },
                {
                  label: t("labels.installPWA"),
                  category: DEFAULT_CATEGORIES.app,
                  predicate: () => !!pwaEvent,
                  perform: () => {
                    if (pwaEvent) {
                      pwaEvent.prompt();
                      pwaEvent.userChoice.then(() => {
                        // event cannot be reused, but we'll hopefully
                        // grab new one as the event should be fired again
                        pwaEvent = null;
                      });
                    }
                  },
                },
              ]}
            />
            {isVisualDebuggerEnabled() && excalidrawAPI && (
              <DebugCanvas
                appState={excalidrawAPI.getAppState()}
                scale={window.devicePixelRatio}
                ref={debugCanvasRef}
              />
            )}
          </Excalidraw>
        </div>
      </div>
      {/* Contextual actions above the selection. It hides itself while the
          lasso overlay is active; it does not need hiding for the tool menu,
          because selecting an object switches to the selection tool, which
          the tool menu has no panel for and closes on. */}
      {graph.dialog}
      {settings.screen}
      {settings.firstRunHint}
      <PagedViewControls {...paged.controlsProps} />
      {newPage.dialog}
      <GlobalPdfDropOverlay mode="document" />
      <ObjectMenu
        excalidrawAPI={excalidrawAPI}
        onOpenBackdrop={backdrops.open}
      />
      <FuzzySelectOverlay excalidrawAPI={excalidrawAPI} />
      <BackdropPanel {...backdrops.panelProps} />
      {isPdfImportOpen && excalidrawAPI && (
        <ImportPdfDialog
          excalidrawAPI={excalidrawAPI}
          theme={editorTheme}
          onClose={() => setIsPdfImportOpen(false)}
        />
      )}
      {isPdfExportOpen && excalidrawAPI && (
        <ExportDialog
          elements={excalidrawAPI.getSceneElements()}
          files={excalidrawAPI.getFiles()}
          appState={excalidrawAPI.getAppState()}
          currentPageNumber={currentPageNumber}
          theme={editorTheme}
          onClose={() => setIsPdfExportOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * A shared-scene URL (`#room=…` for live collaboration, `#json=…` for an
 * imported scene) addresses a scene directly, so it must open the editor
 * rather than dropping the visitor on their own shelf. Such a scene has no
 * library document behind it, so it runs transiently on upstream's
 * `LocalData` persistence.
 */
const hasTransientSceneInUrl = () =>
  /[#&](room|json)=/.test(window.location.hash);

/**
 * Routes between the document shelf and a single open document.
 *
 * A document is addressed by `/d/<docId>`, so a specific assignment can be
 * linked to and the back button behaves. `ExcalidrawWrapper` is keyed on the
 * id, which remounts the editor on document switch rather than trying to
 * swap a live scene underneath it.
 */
const GoodNotesRoot = () => {
  const [docId, setDocId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  // the editor, not the shelf, is what a shared link resolves to
  const [isTransientScene] = useState(hasTransientSceneInUrl);
  // a PDF arriving from the OS share sheet
  const [isShareTarget, setIsShareTarget] = useState(isShareTargetUrl);
  const [isCanvasRoute, setIsCanvasRoute] = useState(
    () => window.location.pathname === "/canvas",
  );
  const { editorTheme } = useDarkMode();
  const canvasConnect = useCanvasConnect({ theme: editorTheme });

  const openDocument = useCallback((doc: DocMeta) => {
    window.history.pushState({}, "", `/d/${encodeURIComponent(doc.id)}`);
    setDocId(doc.id);
  }, []);

  const createAndOpenDocument = useCallback(async () => {
    // straight into a brand-new document. Going via the library made
    // "new document" look like it reopened the last one, because the
    // editor has no New button and the tab strip's "+" went home.
    await flushSceneSaves();
    const doc = await createDoc({});
    window.history.pushState({}, "", `/d/${encodeURIComponent(doc.id)}`);
    setDocId(doc.id);
  }, []);

  const closeDocument = useCallback(() => {
    void flushSceneSaves();
    window.history.pushState({}, "", "/");
    setDocId(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
      setDocId(match ? decodeURIComponent(match[1]) : null);
      setIsShareTarget(isShareTargetUrl());
      setIsCanvasRoute(window.location.pathname === "/canvas");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // the receive screen consumes the shared file, imports it and navigates
  // to /d/<newDocId> itself
  if (isShareTarget) {
    return <ShareTargetReceiver theme={editorTheme} />;
  }

  if (isCanvasRoute) {
    return (
      <>
        <CourseBrowser
          theme={editorTheme}
          onOpenDocument={openDocument}
          onConnect={canvasConnect.open}
        />
        {canvasConnect.dialog}
      </>
    );
  }

  if (!docId && !isTransientScene) {
    return (
      <>
        <Dashboard
          theme={editorTheme}
          onOpenDocument={openDocument}
          headerExtra={<PdfDropZone variant="inline" />}
          onConnectCanvas={canvasConnect.open}
        />
        <GlobalPdfDropOverlay mode="library" />
        {canvasConnect.dialog}
      </>
    );
  }

  return (
    <ExcalidrawWrapper
      key={docId ?? "transient"}
      docId={docId}
      onCloseDocument={closeDocument}
      onNewDocument={() => void createAndOpenDocument()}
    />
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <GoodNotesRoot />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
