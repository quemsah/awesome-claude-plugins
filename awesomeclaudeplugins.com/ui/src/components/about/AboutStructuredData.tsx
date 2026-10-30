/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: <Used to inject ld+json> */
import { getAboutBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { serializeJsonLd } from '../../lib/jsonLd.ts'

export function AboutStructuredData() {
  const aboutPage = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About Awesome Claude Plugins',
    description: 'Learn about the automated discovery workflow behind the Awesome Claude Plugins catalog.',
    url: `${BASE_URL}/about`,
    about: {
      '@type': 'Organization',
      name: 'Awesome Claude Plugins Team',
      url: BASE_URL,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'Awesome Claude Plugins',
      url: BASE_URL,
    },
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: getAboutBreadcrumbs().map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutPage) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} type="application/ld+json" />
    </>
  )
}
