import { Button, Typography } from '@mui/material'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function MessageCard({
  backLink = null,
  homeLink = '/',
  header,
  title,
  message,
  backLinkText,
  homeLinkMessage,
  homeLinkText,
  errorFlag = true
}) {
  const defaults = errorFlag
    ? {
        header: '⚠️ Attention Required',
        title: 'An unexpected error occurred.',
        message:
          'We encountered an issue while processing your request. Please try again shortly or contact support if the problem persists.',
        backLinkText: 'Go Back',
        homeLinkMessage: 'Need to return?',
        homeLinkText: 'Home'
      }
    : {
        header: '✅ Success',
        title: 'Everything went smoothly!',
        message: 'Your request has been successfully processed. You can go back or return home.',
        backLinkText: 'Go Back',
        homeLinkMessage: 'Done here?',
        homeLinkText: 'Home'
      }

  const router = useRouter()
  const handleBack = () => {
    if (backLink) {
      router.push(backLink)
    } else {
      router.back()
    }
  }
  return (
    <div className=' flex flex-col justify-center items-center bs-auto bg-backgroundPaper !min-is-full p-6 md:!min-is-[unset] md:is-[480px]'>
      <div
        className={`block-start-5 sm:block-start-[33px] inline-start-6 sm:inline-start-[38px] text-2xl ${errorFlag ? 'text-red-500' : 'text-green-500'}`}
      >
        {header || defaults.header}
      </div>
      <div className='flex flex-col gap-6 is-full sm:is-auto md:is-full sm:max-is-[400px] md:max-is-[unset] mbs-11 sm:mbs-14 md:mbs-0'>
        <div className='flex flex-col gap-1'>
          <Typography variant='h4'>{title}</Typography>
          <Typography className='text-center'>{message || defaults.message}</Typography>
        </div>
        <Button
          fullWidth
          variant='contained'
          startIcon={<i className='tabler-arrow-left' />}
          onClick={handleBack}
          className='mbe-1'
        >
          {backLinkText || defaults.backLinkText}
        </Button>
        <div className='flex justify-center items-center flex-wrap gap-2'>
          <Typography>{homeLinkMessage || defaults.homeLinkMessage}</Typography>
          <Typography color='primary' component={Link} href={homeLink}>
            {homeLinkText || defaults.homeLinkText}
          </Typography>
        </div>
      </div>
    </div>
  )
}
