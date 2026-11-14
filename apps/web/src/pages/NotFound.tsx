import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { F2MSeal } from '../components/engrave';
import { btnCls, btnGhostCls } from '../components/ui';
import { useT } from '../lib/i18n';
import { HOME_FOR, useAccount } from '../lib/session';

/** A wrong turn, said kindly, with the two ways back. */
export function NotFoundPage() {
  const { t } = useT();
  const { account } = useAccount();
  useEffect(() => {
    document.title = `${t('web.notFound.tab', 'Page not found')} · Farm to Market`;
  }, [t]);
  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen flex-col items-center justify-center bg-[var(--paper)] px-6 text-center">
      <F2MSeal className="h-14 w-14" />
      <h1 className="headline mt-8 max-w-lg text-4xl text-[var(--ink)] sm:text-5xl">
        {t('web.notFound.heading', 'We can’t find that page')}
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--ink-7)]">
        {t('web.notFound.bodyPlain', 'The link may be old or mistyped. Your listings and orders are where you left them.')}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {account ? (
          <Link to={HOME_FOR[account.role]} className={`${btnCls} inline-flex items-center px-6`}>
            {t('web.notFound.desk', 'Back to your desk')}
          </Link>
        ) : (
          <Link to="/login" className={`${btnCls} inline-flex items-center px-6`}>
            {t('web.notFound.signIn', 'Sign in')}
          </Link>
        )}
        <Link to="/" className={`${btnGhostCls} inline-flex items-center px-6`}>
          {t('web.notFound.home', 'Home page')}
        </Link>
      </div>
    </main>
  );
}
