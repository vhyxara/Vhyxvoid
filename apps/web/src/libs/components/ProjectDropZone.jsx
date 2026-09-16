import { useDropzone } from 'react-dropzone'
import AppReactDropzone from '@/libs/styles/AppReactDropzone'
import { Button, Typography } from '@mui/material'
import Loader from '@/libs/components/Loader'
const ProjectDropZone = ({ onDrop, loading }) => {
  const { getRootProps, getInputProps, acceptedFiles, isDragActive, open } = useDropzone({
    multiple: false,

    onDrop
  })

  const files = acceptedFiles.map(file => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ))

  return (
    <>
      <AppReactDropzone className='relative'>
        <div {...getRootProps({ className: 'dropzone' })}>
          {!loading ? (
            <>
              <input {...getInputProps()} />
              <div className='text-center'>
                {isDragActive ? (
                  <p>Release to drop the files here</p>
                ) : (
                  <>
                    <p>Drag and drop CSV files here</p>
                    <p>OR</p>
                    <Button onClick={open}>Click to select file</Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className='absolute bg-black/30 z-50 h-full w-full flex items-center justify-center cursor-not-allowed'>
              <Loader cover='normal' />
              <div className=' absolute flex items-center justify-center mt-24 sm:mt-32 md:mt-28'>
                <Typography className='text-sm sm:text-base md:text-lg text-center'>
                  Almost there! Your product will be uploaded in 5 to 10 minutes.
                </Typography>
              </div>
            </div>
          )}
        </div>
      </AppReactDropzone>
    </>
  )
}

export default ProjectDropZone

{
  /* {loading && (
<div className='absolute bg-black/30 z-50 h-full w-full flex items-center justify-center cursor-not-allowed'>
<Loader cover='normal' />
</div>
)} */
}
// <div className='absolute bg-black/30 z-50 h-full w-full flex flex-col items-center justify-center cursor-not-allowed'>
//   <div className={`relative h-full w-full`} style={{ visibility: 'visible' }}>
//     <div className={`absolute h-full w-full flex items-center justify-center cursor-not-allowed`}>
//       <div className={`relative flex flex-col`}>
//         <CircularProgress variant='determinate' size={50} thickness={3} />
//         <CircularProgress variant='indeterminate' disableShrink size={50} thickness={3} />
//         <Typography variant='body1'>Almost there! Your product will be live in 5 to 10 minutes.</Typography>
//       </div>
//     </div>
//   </div>
// </div>
{
  /* <Loader
cover='normal'
text='Almost there! Your product will be live in 5 to 10 minutes.'
textPosition='bottom'
/> */
}
