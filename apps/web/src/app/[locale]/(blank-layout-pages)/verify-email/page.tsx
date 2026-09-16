// import { Suspense } from 'react'

// import Typography from '@mui/material/Typography'

// import { VerifyEmailForm } from '@/views/auth/VerifyEmailForm'

// // Suspense required because VerifyEmailForm calls useSearchParams()
// export default function VerifyEmailPage() {
//   return (
//     <>
//       <div style={{ marginBottom: 24 }}>
//         <Typography variant='h5' fontWeight={600} gutterBottom>
//           Email verification
//         </Typography>
//       </div>
//       <Suspense>
//         <VerifyEmailForm />
//       </Suspense>
//     </>
//   )
// }
// import { getSystemMode } from '@core/utils/serverHelpers'
// import VerifyEmailSentView from '@/views/auth/VerifyEmailSentView'

// const VerifyEmailSentPage = async () => {
//   const systemMode = await getSystemMode()
//   return <VerifyEmailSentView mode={systemMode} />
// }

// export default VerifyEmailSentPage

import { Suspense } from 'react'

import { getSystemMode } from '@core/utils/serverHelpers'
import VerifyEmailView from '@/views/auth/VerifyEmailView'

const VerifyEmailPage = async () => {
  const systemMode = await getSystemMode()

  return (
    <Suspense>
      <VerifyEmailView mode={systemMode} />
    </Suspense>
  )
}

export default VerifyEmailPage
