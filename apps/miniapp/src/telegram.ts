import {
  backButton,
  hapticFeedback,
  init,
  isTMA,
  mainButton,
  miniApp,
  openLink,
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
  miniApp.mountSync.ifAvailable();
  backButton.mount.ifAvailable();
  swipeBehavior.mount.ifAvailable();
  if (mainButton.mount.isAvailable()) mainButton.mount();
  void viewport.mount
    .ifAvailable()?.[1]
    ?.then(() => viewport.expand.ifAvailable())
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

/** На экранах с drag-and-drop вертикальный свайп не должен закрывать Mini App. */
export function setVerticalSwipes(enabled: boolean) {
  if (!inTelegram) return;
  if (enabled) swipeBehavior.enableVertical.ifAvailable();
  else swipeBehavior.disableVertical.ifAvailable();
}

/**
 * Внешняя ссылка (в т.ч. webcal:// для подписки на календарь).
 * TODO(spec): Telegram официально открывает только http(s); если клиент откажется от webcal —
 * пользователь подпишется по скопированной https-ссылке (инструкция на экране).
 */
export function openExternal(url: string) {
  if (inTelegram && openLink.isAvailable()) {
    try {
      openLink(url);
      return;
    } catch {
      // Неподдерживаемая схема — пробуем как обычную ссылку.
    }
  }
  window.location.href = url;
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
