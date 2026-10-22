import { usePageMeta } from '../../seo/usePageMeta'
import { LegalPage } from './LegalPage'
import { PRIVACY } from './legal'

export default function PrivacyPage() {
  usePageMeta('/privacy')
  return <LegalPage doc={PRIVACY} />
}
