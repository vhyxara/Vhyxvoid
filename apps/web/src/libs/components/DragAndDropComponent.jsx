import { useDropzone } from 'react-dropzone'
import AppReactDropzone from '@/libs/styles/AppReactDropzone'
import { Button, Typography } from '@mui/material'
import Loader from '@/libs/components/Loader'
const DragAndDropComponent = ({ onDrop, loading = false, fileTypeName = '' }) => {
  const { getRootProps, getInputProps, acceptedFiles, isDragActive, open } = useDropzone({
    multiple: false,
    onDrop
  })

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
                    <p>Drag and drop {fileTypeName} file here</p>
                    <p>OR</p>
                    <Button onClick={open} disabled={loading}>
                      Click to select file
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className='absolute bg-black/30 z-50 h-full w-full flex items-center justify-center cursor-not-allowed'>
              <Loader cover='normal' />
              <div className=' absolute flex items-center justify-center mt-24 sm:mt-32 md:mt-28 px-2'>
                <Typography className='text-sm sm:text-base md:text-lg text-center'>
                  Almost there! Your {fileTypeName} file will be Kinect 2 to 3 minutes.
                </Typography>
              </div>
            </div>
          )}
        </div>
      </AppReactDropzone>
    </>
  )
}

export default DragAndDropComponent
