import { useT } from '../lib/i18n';

/**
 * The first thing a keyboard or screen-reader user meets on every page: a
 * jump past the header straight to the content (WCAG 2.4.1). Invisible until
 * it receives focus, then it appears as a pill in the top-left corner.
 */
export function SkipLink({ target = 'main' }: { target?: string }) {
  const { t } = useT();
  return (
    <a
      href={`#${target}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-[var(--forest-night)] focus:px-5 focus:text-sm focus:font-semibold focus:text-[var(--paper-lift)] focus:shadow-lg"
    >
      {t('web.common.skip', 'Skip to content')}
    </a>
  );
}
