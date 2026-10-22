import { usePageMeta } from '../../seo/usePageMeta'
import { LegalPage } from './LegalPage'
import { TERMS } from './legal'

export default function TermsPage() {
  usePageMeta('/terms')
  return <LegalPage doc={TERMS} />
}
