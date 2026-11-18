import {
  backButton,
  hapticFeedback,
  init,
  isTMA,
  mainButton,
  miniApp,
  openLink,
  openTelegramLink,
  requestWriteAccess,
  retrieveLaunchParams,
  retrieveRawInitData,
  swipeBehavior,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';

export interface TelegramEnv {
  inTelegram: boolean;
  initData: string | null;
  startParam: string | null;
}

let inTelegram = false;

/** Инициализирует SDK, если приложение открыто внутри Telegram. */
export function initTelegram(): TelegramEnv {
  scrollFocusedFieldIntoView();
  if (!isTMA()) return { inTelegram: false, initData: null, startParam: null };

  init();
  inTelegram = true;
  themeParams.mountSync.ifAvailable();
  themeParams.bindCssVars.ifAvailable();
  // Нативные поля (дата, время, списки) красятся по теме Telegram, а не по теме системы:
  // иначе в тёмном Telegram на светлой Windows значок календаря получается чёрным.
  const applyScheme = () => {
    document.documentElement.dataset.theme = themeParams.isDark() ? 'dark' : 'light';
  };
  applyScheme();
  themeParams.isDark.sub(applyScheme);
  miniApp.mountSync.ifAvailable();
  backButton.mount.ifAvailable();
  swipeBehavior.mount.ifAvailable();
  if (mainButton.mount.isAvailable()) mainButton.mount();
  void viewport.mount
    .ifAvailable()?.[1]
    ?.then(() => {
      viewport.expand.ifAvailable();
      // --tg-viewport-safe-area-inset-bottom: полоска «домой» на iPhone, env() в WebView часто 0.
      viewport.bindCssVars.ifAvailable();
    })
    .catch(() => {});
  miniApp.ready.ifAvailable();

  const lp = retrieveLaunchParams();
  return {
    inTelegram: true,
    initData: retrieveRawInitData() ?? null,
    startParam: lp.tgWebAppStartParam ?? null,
  };
}

export function isInTelegram() {
  return inTelegram;
}

// Клиенты Telegram для компьютера: Desktop, macOS, веб-версии.
const DESKTOP_PLATFORMS = new Set(['tdesktop', 'macos', 'web', 'weba', 'webk', 'unigram']);
let desktop: boolean | undefined;

/**
 * Компьютер, а не телефон. На телефоне системные списки выглядят хорошо (барабан iOS,
 * окно Android), на компьютере — заменяем своими. Вне Telegram — по типу указателя.
 */
export function isDesktop(): boolean {
  if (desktop !== undefined) return desktop;
  try {
    desktop = inTelegram
      ? DESKTOP_PLATFORMS.has(retrieveLaunchParams().tgWebAppPlatform)
      : window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    desktop = false;
  }
  return desktop;
}

/** На экранах с drag-and-drop вертикальный свайп не должен закрывать Mini App. */
export function setVerticalSwipes(enabled: boolean) {
  if (!inTelegram) return;
  if (enabled) swipeBehavior.enableVertical.ifAvailable();
  else swipeBehavior.disableVertical.ifAvailable();
}

/** Внешняя https-ссылка. */
export function openExternal(url: string) {
  if (inTelegram && openLink.isAvailable()) {
    try {
      openLink(url);
      return;
    } catch {
      // Клиент отказался — пробуем как обычную ссылку.
    }
  }
  window.location.href = url;
}

/** Профиль человека в Telegram (t.me/username): внутри Telegram — без закрытия Mini App. */
export function openTelegramProfile(username: string) {
  openTelegramUrl(`https://t.me/${encodeURIComponent(username)}`);
}

/** Ссылка t.me (чат, бот): внутри Telegram открывается самим клиентом. */
export function openTelegramUrl(url: string) {
  if (inTelegram && openTelegramLink.isAvailable()) {
    try {
      openTelegramLink(url);
      return;
    } catch {
      // Клиент отказался — пробуем как обычную ссылку.
    }
  }
  window.open(url, '_blank', 'noopener');
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light') {
  if (!inTelegram) return;
  if (kind === 'light') hapticFeedback.impactOccurred.ifAvailable('light');
  else hapticFeedback.notificationOccurred.ifAvailable(kind);
}

/** Просит разрешение писать пользователю. true — разрешил. Вне Telegram — false. */
export async function askWriteAccess(): Promise<boolean> {
  if (!inTelegram || !requestWriteAccess.isAvailable()) return false;
  try {
    return (await requestWriteAccess()) === 'allowed';
  } catch {
    return false;
  }
}

export interface MainButtonParams {
  text: string;
  enabled: boolean;
  loading: boolean;
}

export function setMainButton(p: MainButtonParams) {
  mainButton.setParams.ifAvailable({
    text: p.text,
    isVisible: true,
    isEnabled: p.enabled,
    isLoaderVisible: p.loading,
  });
}

/** Подписка на нажатие MainButton; отписка заодно прячет кнопку. */
export function onMainButton(onClick: () => void): () => void {
  const off = mainButton.onClick.ifAvailable(onClick);
  return () => {
    if (off[0]) off[1]();
    mainButton.setParams.ifAvailable({ isVisible: false, isLoaderVisible: false });
  };
}

export function showBackButton(onClick: () => void): () => void {
  backButton.show.ifAvailable();
  const off = backButton.onClick.ifAvailable(onClick);
  return () => {
    if (off[0]) off[1]();
    backButton.hide.ifAvailable();
  };
}

// На iOS клавиатура перекрывает поля ввода — прокручиваем поле в видимую область.
function scrollFocusedFieldIntoView() {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
  });
}
