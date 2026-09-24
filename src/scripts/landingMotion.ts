import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Movimiento de la landing LÚCIDA.
 *
 * Mejora progresiva: sin este módulo el contenido queda en su estado CSS.
 * Solo anima transform y clip-path. El scroll es el nativo del navegador.
 *
 * initLandingMotion() es idempotente por página. En Astro, astro:before-swap
 * limpia la sesión y astro:page-load refresca o vuelve a montar.
 */

const LOG_TAG = "[LandingMotion]";
const TRIGGER_PREFIX = "landing-motion";
const HEADER_STATE_ATTR = "data-header-state";
const HEADER_SCROLL_OFFSET = 48;
const HEADER_PIN_OFFSET = 68;

const BREAKPOINT = {
  tabletMin: 768,
  desktopMin: 1024,
} as const;

const MEDIA = {
  isDesktop: `(min-width: ${BREAKPOINT.desktopMin}px)`,
  isTablet: `(min-width: ${BREAKPOINT.tabletMin}px) and (max-width: ${BREAKPOINT.desktopMin - 0.02}px)`,
  isMobile: `(max-width: ${BREAKPOINT.tabletMin - 0.02}px)`,
  reduceMotion: "(prefers-reduced-motion: reduce)",
} as const;

export const landingMotionHooks = {
  heroMedia: "[data-hero-media]",
  heroCopy: "[data-hero-copy]",
  billStage: "[data-bill-stage]",
  billLayer: "[data-bill-layer]",
  reveal: "[data-reveal]",
  header: "[data-header]",
  headerState: HEADER_STATE_ATTR,
} as const;

const REVEAL_VARIANTS = ["lift", "mask", "rule", "drift"] as const;
const BILL_VARIANTS = ["sheet", "line", "note", "scan"] as const;

type Breakpoint = "desktop" | "tablet" | "mobile";
type RevealVariant = (typeof REVEAL_VARIANTS)[number];
type BillVariant = (typeof BILL_VARIANTS)[number];
type VerticalPlacement = "above" | "visible" | "below";
type Release = () => void;

interface MotionProfile {
  breakpoint: Breakpoint;
  revealDistance: number;
  billShift: number;
  billInset: number;
  heroMediaY: number;
  heroCopyY: number;
  scrub: number | true;
  pinBill: boolean;
}

interface ClipRestore {
  frame: HTMLElement;
  previous: string;
  changed: boolean;
}

interface BillMount {
  release: Release;
  pinned: boolean;
}

interface LandingMotionWindow extends Window {
  __lucidaLandingMotionBound?: boolean;
}

let engineReady = false;
let pageGeneration = 0;
let activeGeneration = -1;
let activeDispose: Release | null = null;
let startupLoggedGeneration = -1;
let reducedLoggedGeneration = -1;

/** TEMPORAL: diagnóstico de arranque. Retirar cuando el ciclo de vida quede estable. */
function logStartup(data: {
  breakpoint: Breakpoint;
  pinned: boolean;
  hooks: Record<string, number>;
}): void {
  if (!import.meta.env.DEV) return;
  console.info(`${LOG_TAG} Movimiento inicializado`, {
    context: "initLandingMotion",
    ...data,
  });
}

/** AUDITORÍA: rama de accesibilidad. Mantener. */
function logReducedMotion(breakpoint: Breakpoint): void {
  if (!import.meta.env.DEV) return;
  console.info(`${LOG_TAG} prefers-reduced-motion activo`, {
    context: "initLandingMotion",
    reduceMotion: true,
    breakpoint,
  });
}

/** AUDITORÍA: error inesperado. Mantener. */
function logUnexpected(message: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  const details =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownError", message: String(error) };
  console.error(`${LOG_TAG} ${message}`, {
    context: "initLandingMotion",
    error: details,
  });
}

function runSafely(effect: Release): void {
  try {
    effect();
  } catch (error) {
    logUnexpected("Error inesperado al limpiar movimiento", error);
  }
}

function ensureEngine(): void {
  gsap.registerPlugin(ScrollTrigger);
  if (engineReady) return;
  engineReady = true;
  ScrollTrigger.config({
    ignoreMobileResize: true,
    limitCallbacks: true,
  });
}

function queryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (root instanceof HTMLElement && root.matches(selector)) {
    return [root, ...found];
  }
  return found;
}

function isListed<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value);
}

function readRevealVariant(element: HTMLElement, index: number): RevealVariant {
  const value = element.dataset.reveal ?? "";
  if (isListed(REVEAL_VARIANTS, value)) return value;
  return REVEAL_VARIANTS[index % REVEAL_VARIANTS.length] ?? "lift";
}

function readBillVariant(element: HTMLElement, index: number): BillVariant {
  const value = element.dataset.billLayer ?? "";
  if (isListed(BILL_VARIANTS, value)) return value;
  return BILL_VARIANTS[index % BILL_VARIANTS.length] ?? "sheet";
}

function resolveBreakpoint(conditions: gsap.Conditions | undefined): Breakpoint {
  if (conditions?.isDesktop === true) return "desktop";
  if (conditions?.isTablet === true) return "tablet";
  return "mobile";
}

function createProfile(breakpoint: Breakpoint): MotionProfile {
  switch (breakpoint) {
    case "desktop":
      return {
        breakpoint,
        revealDistance: 28,
        billShift: 22,
        billInset: 10,
        heroMediaY: 6,
        heroCopyY: -16,
        scrub: 0.45,
        pinBill: true,
      };
    case "tablet":
      return {
        breakpoint,
        revealDistance: 16,
        billShift: 14,
        billInset: 6,
        heroMediaY: 3,
        heroCopyY: 0,
        scrub: true,
        pinBill: false,
      };
    case "mobile":
      return {
        breakpoint,
        revealDistance: 10,
        billShift: 8,
        billInset: 8,
        heroMediaY: 0,
        heroCopyY: 0,
        scrub: true,
        pinBill: false,
      };
    default: {
      const unreachable: never = breakpoint;
      return unreachable;
    }
  }
}

function verticalPlacement(element: HTMLElement): VerticalPlacement {
  const rect = element.getBoundingClientRect();
  if (rect.bottom <= 0) return "above";
  if (rect.top >= window.innerHeight) return "below";
  return "visible";
}

function maskInset(distance: number): number {
  return Math.min(14, Math.max(8, Math.round(distance * 0.45)));
}

function revealFrom(variant: RevealVariant, distance: number): gsap.TweenVars {
  switch (variant) {
    case "lift":
      return { y: distance };
    case "mask":
      return { clipPath: `inset(${maskInset(distance)}% 0% 0% 0%)` };
    case "rule":
      return { clipPath: `inset(0% ${maskInset(distance)}% 0% 0%)` };
    case "drift":
      return {
        y: Math.round(distance * 0.65),
        clipPath: "inset(0% 0% 10% 0%)",
      };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function revealTo(variant: RevealVariant): gsap.TweenVars {
  switch (variant) {
    case "lift":
      return { y: 0 };
    case "mask":
      return { clipPath: "inset(0% 0% 0% 0%)" };
    case "rule":
      return { clipPath: "inset(0% 0% 0% 0%)" };
    case "drift":
      return { y: 0, clipPath: "inset(0% 0% 0% 0%)" };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function revealDuration(variant: RevealVariant, breakpoint: Breakpoint): number {
  let base: number;
  switch (variant) {
    case "lift":
      base = 0.7;
      break;
    case "mask":
      base = 0.85;
      break;
    case "rule":
      base = 0.55;
      break;
    case "drift":
      base = 0.75;
      break;
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }

  switch (breakpoint) {
    case "desktop":
      return base;
    case "tablet":
      return base * 0.9;
    case "mobile":
      return base * 0.8;
    default: {
      const unreachable: never = breakpoint;
      return unreachable;
    }
  }
}

function revealEase(variant: RevealVariant): string {
  switch (variant) {
    case "lift":
      return "power2.out";
    case "mask":
      return "power1.out";
    case "rule":
      return "power3.out";
    case "drift":
      return "power2.inOut";
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function billFrom(variant: BillVariant, profile: MotionProfile): gsap.TweenVars {
  const inset = profile.billInset;
  const edge = Math.max(inset - 2, 0);
  switch (variant) {
    case "sheet":
      return { clipPath: `inset(${inset}% ${edge}% ${inset}% ${edge}%)` };
    case "line":
      return { clipPath: `inset(0% ${Math.min(inset + 8, 18)}% 0% 0%)` };
    case "note":
      return { y: profile.billShift };
    case "scan":
      return { clipPath: `inset(0% 0% ${Math.min(inset + 6, 16)}% 0%)` };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function billTo(variant: BillVariant): gsap.TweenVars {
  switch (variant) {
    case "sheet":
    case "line":
    case "scan":
      return { clipPath: "inset(0% 0% 0% 0%)" };
    case "note":
      return { y: 0 };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

function prepareMediaFrame(media: HTMLElement): ClipRestore | null {
  const frame = media.parentElement;
  if (!frame || frame === document.body || frame === document.documentElement) return null;
  if (frame.tagName === "MAIN") return null;

  const overflow = getComputedStyle(frame).overflowY;
  if (overflow !== "visible") {
    return { frame, previous: frame.style.overflow, changed: false };
  }

  const previous = frame.style.overflow;
  frame.style.overflow = "clip";
  return { frame, previous, changed: true };
}

function restoreMediaFrame(restore: ClipRestore): void {
  if (!restore.changed) return;
  restore.frame.style.overflow = restore.previous;
}

function siblingDelay(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return 0;
  const peers = Array.from(parent.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute("data-reveal"),
  );
  const index = peers.indexOf(element);
  if (index <= 0) return 0;
  return Math.min(index, 4) * 0.05;
}

function shouldSkipReveal(element: HTMLElement): boolean {
  const owned = `${landingMotionHooks.billStage}, ${landingMotionHooks.heroMedia}, ${landingMotionHooks.heroCopy}, ${landingMotionHooks.header}`;
  if (element.closest(owned)) return true;
  return element.querySelector(owned) !== null;
}

function clearMotionProps(element: HTMLElement): void {
  gsap.set(element, { clearProps: "transform,clipPath" });
}

function mountHeader(): Release {
  const headers = queryAll(landingMotionHooks.header);
  const releases = headers.map((header, index) => {
    const previous = header.getAttribute(HEADER_STATE_ATTR);
    const apply = (scrolled: boolean) => {
      header.setAttribute(HEADER_STATE_ATTR, scrolled ? "scrolled" : "top");
    };

    apply(window.scrollY > HEADER_SCROLL_OFFSET);
    const trigger = ScrollTrigger.create({
      id: `${TRIGGER_PREFIX}-header-${index}`,
      start: HEADER_SCROLL_OFFSET,
      end: "max",
      onToggle: (self) => {
        apply(self.isActive);
      },
    });

    return () => {
      trigger.kill(true);
      if (previous === null) header.removeAttribute(HEADER_STATE_ATTR);
      else header.setAttribute(HEADER_STATE_ATTR, previous);
    };
  });

  return () => releases.forEach(runSafely);
}

function mountHero(profile: MotionProfile): Release {
  const releases: Release[] = [];

  if (profile.heroMediaY !== 0) {
    queryAll(landingMotionHooks.heroMedia).forEach((media, index) => {
      const frame = prepareMediaFrame(media);
      if (!frame) return;
      releases.push(() => restoreMediaFrame(frame));
      gsap.to(media, {
        yPercent: profile.heroMediaY,
        ease: "none",
        force3D: "auto",
        scrollTrigger: {
          id: `${TRIGGER_PREFIX}-hero-media-${index}`,
          trigger: media,
          start: "top top",
          end: "bottom top",
          scrub: profile.scrub,
          invalidateOnRefresh: true,
        },
      });
    });
  }

  if (profile.heroCopyY !== 0) {
    queryAll(landingMotionHooks.heroCopy).forEach((copy, index) => {
      gsap.to(copy, {
        y: profile.heroCopyY,
        ease: "none",
        force3D: "auto",
        scrollTrigger: {
          id: `${TRIGGER_PREFIX}-hero-copy-${index}`,
          trigger: copy,
          start: "top top",
          end: "bottom top",
          scrub: profile.scrub,
          invalidateOnRefresh: true,
        },
      });
    });
  }

  return () => releases.forEach(runSafely);
}

function mountLayerOnce(
  layer: HTMLElement,
  index: number,
  profile: MotionProfile,
): void {
  const variant = readBillVariant(layer, index);
  gsap.fromTo(layer, billFrom(variant, profile), {
    ...billTo(variant),
    duration: profile.breakpoint === "mobile" ? 0.5 : 0.7,
    delay: Math.min(index, 4) * 0.04,
    ease: "power2.out",
    overwrite: "auto",
    immediateRender: true,
    force3D: "auto",
    onComplete: () => clearMotionProps(layer),
    scrollTrigger: {
      id: `${TRIGGER_PREFIX}-bill-layer-${index}`,
      trigger: layer,
      start: "top 88%",
      once: true,
    },
  });
}

function mountFlowingBill(stage: HTMLElement, profile: MotionProfile, idOffset: number): Release {
  const layers = queryAll(landingMotionHooks.billLayer, stage)
    .map((layer, index) => ({
      layer,
      index: idOffset + index,
      placement: verticalPlacement(layer),
    }))
    .filter(({ placement }) => placement === "below");

  layers.forEach(({ layer, index }) => mountLayerOnce(layer, index, profile));
  return () => {};
}

function mountPinnedBill(stage: HTMLElement, profile: MotionProfile): BillMount {
  const layers = queryAll(landingMotionHooks.billLayer, stage);
  if (layers.length === 0) {
    return { release: () => {}, pinned: false };
  }

  const timeline = gsap.timeline({
    defaults: { ease: "none", force3D: "auto" },
    scrollTrigger: {
      id: `${TRIGGER_PREFIX}-bill`,
      trigger: stage,
      start: `top ${HEADER_PIN_OFFSET}px`,
      end: () => {
        const screens = Math.min(Math.max(layers.length, 1) * 0.42, 1.15);
        return `+=${Math.round(window.innerHeight * screens)}`;
      },
      pin: true,
      pinSpacing: true,
      scrub: profile.scrub,
      anticipatePin: 1,
      fastScrollEnd: true,
      invalidateOnRefresh: true,
    },
  });

  layers.forEach((layer, index) => {
    const variant = readBillVariant(layer, index);
    timeline.fromTo(
      layer,
      billFrom(variant, profile),
      { ...billTo(variant), duration: 1 },
      index * 0.55,
    );
  });

  return { pinned: true, release: () => {} };
}

function mountBill(profile: MotionProfile): BillMount {
  const stages = queryAll(landingMotionHooks.billStage);
  const primary = stages[0];
  if (!primary) return { release: () => {}, pinned: false };

  const releases: Release[] = [];
  let pinned = false;

  if (profile.pinBill) {
    const pinnedMount = mountPinnedBill(primary, profile);
    pinned = pinnedMount.pinned;
    releases.push(pinnedMount.release);
    if (!pinned) releases.push(mountFlowingBill(primary, profile, 0));
  } else {
    releases.push(mountFlowingBill(primary, profile, 0));
  }

  let offset = queryAll(landingMotionHooks.billLayer, primary).length;
  for (const stage of stages.slice(1)) {
    releases.push(mountFlowingBill(stage, profile, offset));
    offset += queryAll(landingMotionHooks.billLayer, stage).length;
  }

  return {
    pinned,
    release: () => releases.forEach(runSafely),
  };
}

function mountReveals(profile: MotionProfile): Release {
  const reveals = queryAll(landingMotionHooks.reveal)
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => !shouldSkipReveal(element))
    .map((candidate) => ({
      ...candidate,
      placement: verticalPlacement(candidate.element),
    }))
    .filter(({ placement }) => placement === "below");

  reveals.forEach(({ element, index }) => {
    const variant = readRevealVariant(element, index);
    gsap.fromTo(element, revealFrom(variant, profile.revealDistance), {
      ...revealTo(variant),
      duration: revealDuration(variant, profile.breakpoint),
      delay: siblingDelay(element),
      ease: revealEase(variant),
      overwrite: "auto",
      immediateRender: true,
      force3D: "auto",
      onComplete: () => clearMotionProps(element),
      scrollTrigger: {
        id: `${TRIGGER_PREFIX}-reveal-${index}`,
        trigger: element,
        start: "top 90%",
        once: true,
      },
    });
  });

  return () => {};
}

function useMount(releases: Release[], mount: () => Release, label: string): void {
  try {
    releases.push(mount());
  } catch (error) {
    logUnexpected(`Error inesperado al montar ${label}`, error);
  }
}

function hookCounts(): Record<string, number> {
  return {
    heroMedia: queryAll(landingMotionHooks.heroMedia).length,
    heroCopy: queryAll(landingMotionHooks.heroCopy).length,
    billStage: queryAll(landingMotionHooks.billStage).length,
    billLayer: queryAll(landingMotionHooks.billLayer).length,
    reveal: queryAll(landingMotionHooks.reveal).length,
    header: queryAll(landingMotionHooks.header).length,
  };
}

function refreshTriggers(session: number): void {
  if (activeGeneration !== session) return;
  try {
    ScrollTrigger.refresh();
  } catch (error) {
    logUnexpected("Error inesperado al refrescar ScrollTrigger", error);
  }
}

function watchLayoutImages(session: number): Release {
  const scopes = [
    ...queryAll(landingMotionHooks.heroMedia),
    ...queryAll(landingMotionHooks.billStage),
  ];
  const images = scopes.flatMap((scope) => [
    ...(scope instanceof HTMLImageElement ? [scope] : []),
    ...Array.from(scope.querySelectorAll("img")),
  ]);
  const pending = images.filter((image) => !image.complete);
  if (pending.length === 0) return () => {};

  let remaining = pending.length;
  const finish = () => {
    remaining -= 1;
    if (remaining === 0) refreshTriggers(session);
  };

  for (const image of pending) {
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  }

  return () => {
    for (const image of pending) {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
    }
  };
}

function createSession(session: number): Release {
  ensureEngine();
  const releases: Release[] = [];
  const matchMedia = gsap.matchMedia();

  matchMedia.add(
    {
      isDesktop: MEDIA.isDesktop,
      isTablet: MEDIA.isTablet,
      isMobile: MEDIA.isMobile,
      reduceMotion: MEDIA.reduceMotion,
    },
    (context) => {
      const localReleases: Release[] = [];
      const breakpoint = resolveBreakpoint(context.conditions);

      useMount(localReleases, mountHeader, "header");

      if (context.conditions?.reduceMotion === true) {
        if (reducedLoggedGeneration !== pageGeneration) {
          reducedLoggedGeneration = pageGeneration;
          logReducedMotion(breakpoint);
        }
        return () => localReleases.forEach(runSafely);
      }

      const profile = createProfile(breakpoint);
      useMount(localReleases, () => mountHero(profile), "hero");

      let pinned = false;
      try {
        const bill = mountBill(profile);
        pinned = bill.pinned;
        localReleases.push(bill.release);
      } catch (error) {
        logUnexpected("Error inesperado al montar el análisis de factura", error);
      }

      useMount(localReleases, () => mountReveals(profile), "revelados");

      if (startupLoggedGeneration !== pageGeneration) {
        startupLoggedGeneration = pageGeneration;
        logStartup({ breakpoint, pinned, hooks: hookCounts() });
      }

      return () => localReleases.forEach(runSafely);
    },
  );

  releases.push(() => matchMedia.revert());
  releases.push(watchLayoutImages(session));

  if (document.fonts) {
    let cancelled = false;
    releases.push(() => {
      cancelled = true;
    });
    document.fonts.ready
      .then(() => {
        if (!cancelled) refreshTriggers(session);
      })
      .catch((error: unknown) => {
        logUnexpected("Error inesperado al esperar fuentes", error);
      });
  }

  requestAnimationFrame(() => refreshTriggers(session));

  return () => releases.forEach(runSafely);
}

function disposeActiveMotion(): void {
  const dispose = activeDispose;
  activeDispose = null;
  activeGeneration = -1;
  dispose?.();
}

function bindPageLifecycle(): void {
  const target = window as LandingMotionWindow;
  if (target.__lucidaLandingMotionBound) return;
  target.__lucidaLandingMotionBound = true;

  document.addEventListener("astro:before-swap", () => {
    pageGeneration += 1;
    disposeActiveMotion();
  });

  document.addEventListener("astro:page-load", () => {
    if (activeDispose && activeGeneration === pageGeneration) {
      refreshTriggers(pageGeneration);
      return;
    }
    initLandingMotion();
  });
}

/**
 * Monta el movimiento de la página actual.
 * Devuelve la limpieza de esta sesión. Llamarla dos veces no duplica triggers.
 */
export function initLandingMotion(): Release {
  if (typeof document === "undefined") return () => {};

  bindPageLifecycle();
  ensureEngine();

  if (activeDispose && activeGeneration === pageGeneration) {
    return activeDispose;
  }

  disposeActiveMotion();

  const session = pageGeneration;
  let sessionDispose: Release = () => {};
  try {
    sessionDispose = createSession(session);
  } catch (error) {
    logUnexpected("Error inesperado al inicializar", error);
    return () => {};
  }

  let didRun = false;
  const guarded = () => {
    if (didRun) return;
    didRun = true;
    if (activeDispose === guarded) {
      activeDispose = null;
      activeGeneration = -1;
    }
    runSafely(sessionDispose);
  };

  activeDispose = guarded;
  activeGeneration = session;
  return guarded;
}

function bootstrapLandingMotion(): void {
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initLandingMotion(), { once: true });
    return;
  }
  initLandingMotion();
}

bootstrapLandingMotion();
