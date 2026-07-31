import Link from 'next/link'
import { BASE_URL } from '../../lib/constants.ts'

export const metadata = {
  title: 'Privacy',
  description: 'Privacy information for Awesome Claude Plugins.',
  alternates: {
    canonical: `${BASE_URL}/privacy`,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <article className="container mx-auto max-w-3xl px-4 py-8 text-muted-foreground">
        <h1 className="mb-6 font-bold text-3xl text-foreground">Privacy</h1>
        <div className="space-y-5">
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Catalog data</h2>
            <p>
              Awesome Claude Plugins displays public GitHub repository metadata and plugin marketplace information. Repository details are
              requested from GitHub when you open a repository page.
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Analytics</h2>
            <p>
              In production, we use Simple Analytics to understand aggregate site usage. The analytics script honors Do Not Track and is not
              loaded when your browser enables Global Privacy Control. Read the{' '}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href="https://www.simpleanalytics.com/privacy"
                rel="noopener noreferrer"
                target="_blank"
              >
                Simple Analytics privacy policy
              </a>
              .
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Browser storage</h2>
            <p>
              We store your theme preference in local storage and your most recent catalog search URL in session storage. Both are
              functional preferences and can be cleared in your browser settings.
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Security reports</h2>
            <p>
              Browsers may send a Content Security Policy violation report when a page attempts to load a disallowed resource. We use the
              page path and violated policy directive to investigate site security.
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Performance measurement</h2>
            <p>
              We collect anonymous Core Web Vitals names, values, and ratings to monitor site performance. These reports do not include your
              search terms, repository choices, or other page content.
            </p>
          </section>
          <section>
            <h2 className="mb-2 font-semibold text-foreground text-xl">Contact</h2>
            <p>
              Report a security issue through the{' '}
              <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/.well-known/security.txt">
                security contact policy
              </Link>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
