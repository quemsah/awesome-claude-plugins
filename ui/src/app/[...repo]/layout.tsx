import ReactDom from 'react-dom'

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  ReactDom.preconnect('https://avatars.githubusercontent.com', { crossOrigin: 'anonymous' })
  return <>{children}</>
}
