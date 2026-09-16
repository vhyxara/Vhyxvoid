import { copyToClipboard } from '@/utils/copyToClipboard'
import { Card, CardContent, CardHeader, Typography } from '@mui/material'

const CardInfo = ({ title, info }) => (
  <Card className='h-full'>
    <CardHeader title={title} />
    <CardContent>
      {Object.entries(info).map(([key, value]) => (
        <div key={key} className='flex justify-between gap-5 group p-2'>
          <div className='flex items-center gap-2'>
            <Typography className='font-bold text-md cursor-pointer group-hover:text-error underline'>{key}</Typography>
          </div>

          <div>
            <Typography
              className='font-semibold text-sm text-center cursor-pointer group-hover:text-linkedin'
              style={{
                display: 'block',
                maxWidth: '100%',
                overflow: 'hidden',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                wordWrap: 'break-word'
              }}
              onClick={() => copyToClipboard(value, `${key} Copied`)}
            >
              {value}
            </Typography>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
)

export default CardInfo
