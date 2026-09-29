/**
 * An address the site does not have.
 *
 * This used to redirect to the home page, which told a customer nothing about
 * the typo in their link and told search engines that every mistyped URL was a
 * copy of the home page. Now it says so, is marked noindex, and offers the
 * places people were most likely looking for.
 */
import { Link } from 'react-router-dom';
import { useSeo } from './Seo';
import { BackLink, CallButton, SiteEmpty } from './kit';

export default function NotFound() {
  useSeo({ title: 'Page not found', noindex: true });
  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell mx-auto max-w-2xl">
        <BackLink to="/" className="mb-4" />
        <h1 className="sr-only">Page not found</h1>
        <SiteEmpty
          emoji={'\u{1F9ED}'}
          title="We could not find that page"
          body="The link may be mistyped or out of date. These are the places most people are looking for."
          action={
            <>
              <Link to="/" className="grad-brand btn h-11 rounded-full px-5 text-sm font-semibold text-white">Home</Link>
              <Link to="/outstation" className="btn h-11 rounded-full bg-ink-50 px-5 text-sm font-semibold text-ink-700 hover:bg-ink-100">Outstation cabs</Link>
              <Link to="/enquiry" className="btn h-11 rounded-full bg-ink-50 px-5 text-sm font-semibold text-ink-700 hover:bg-ink-100">Send an enquiry</Link>
              <CallButton className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white" label="Call us" />
            </>
          }
        />
      </div>
    </div>
  );
}
