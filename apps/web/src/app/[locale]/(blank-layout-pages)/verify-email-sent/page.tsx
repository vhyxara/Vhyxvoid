import { getSystemMode } from '@core/utils/serverHelpers'
import VerifyEmailSentView from '@/views/auth/VerifyEmailSentView'

const VerifyEmailSentPage = async () => {
  const systemMode = await getSystemMode()

  return <VerifyEmailSentView mode={systemMode} />
}

export default VerifyEmailSentPage
