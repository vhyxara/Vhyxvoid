'use client'

import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import { useState, useCallback } from 'react'
import { Button, Box, Typography } from '@mui/material'
import Loader from '@/libs/components/Loader'
import DragAndDropComponent from '@/libs/components/DragAndDropComponent'
import { toast } from 'react-toastify'
import DialogCloseButton from '@/components/dialogs/DialogCloseButton'
import { useFeedback } from '@/contexts/FeedbackContext'
import fetchData from '@/utils/fetchData'

export default function FileUploadDialog({
  isOpen = false,
  fetchDataCallback,
  buttonText = 'Upload File',
  apiUrl,
  fileType = 'application/json',
  fileValidation = file => file.type === fileType,
  handleFileUpload,
  successMessage = 'File uploaded successfully',
  errorMessage = 'An error occurred during file upload',
  fileTypeName = '',
  header = 'File Upload',
  buttonClassName = ''
}) {
  const { showFeedback } = useFeedback()
  const [isDialogOpen, setIsDialogOpen] = useState(isOpen)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [isFailed, setIsFailed] = useState(false)
  const [responseMessage, setResponseMessage] = useState('')
  console.log('file', file)

  const resetState = () => {
    setFile(null)
    setFileName('')
    setIsFailed(false)
    setResponseMessage('')
  }
  const handleClickOpen = () => setIsDialogOpen(true)
  const handleClose = () => {
    if (loading) {
      // Show a toast message to inform the user they can't close the dialog while uploading
      toast.info('Please wait until the file is uploading.', { position: 'bottom-center' })
      return // Prevent closing the dialog while the upload is in progress
    }

    resetState()

    setIsDialogOpen(false)
  }

  const onDrop = useCallback(
    acceptedFiles => {
      const file = acceptedFiles[0]
      if (file && fileValidation(file)) {
        setFile(file)
        setFileName(file.name)
      } else {
        setFile(null)
        toast.error('Upload a valid file', 'bottom')
        setFileName('')
        // resetState()
      }
    },
    [fileValidation]
  )

  const handleRemoveFile = () => {
    // setFile(null)
    // setFileName('')
    resetState()
  }

  const handleUploadAgain = () => {
    // setIsFailed(false)
    resetState()
  }

  const handleUploadFile = async () => {
    if (!file) {
      toast.error('No file selected')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setLoading(true)

    try {
      if (!apiUrl) {
        toast.error('API endpoint not provided')
        return
      }

      const response = await fetchData(apiUrl, 'POST', formData, 'file')

      if (response.success) {
        showFeedback(response.message || successMessage, 'success')

        resetState()
        fetchDataCallback && fetchDataCallback()
      } else {
        setIsFailed(false)

        setResponseMessage(response.message || errorMessage)

        resetState()
        throw new Error(response.message)
      }
    } catch (error) {
      //   showFeedback(error.message || errorMessage, 'error')

      resetState()
      setIsFailed(true)
      setResponseMessage(error.message || errorMessage)
    } finally {
      setLoading(false)
      //   handleClose()
    }
  }

  return (
    <>
      <Button
        variant={'contained'}
        color={'primary'}
        onClick={handleClickOpen}
        startIcon={''}
        className={`${buttonClassName}`}
      >
        {buttonText}
      </Button>

      <Dialog
        open={isDialogOpen}
        disableEscapeKeyDown
        maxWidth='500px'
        onClose={(event, reason) => {
          if (reason !== 'backdropClick') {
            handleClose()
          }
        }}
        closeAfterTransition={false}
      >
        <DialogCloseButton onClick={handleClose} disableRipple className='m-4'>
          <i className='tabler-x text-[22px]' />
        </DialogCloseButton>
        <div className='w-[500px]'>
          <div className='pt-5 px-5'>
            <Typography className='text-textPrimary text-lg'>{header}</Typography>
          </div>
          <div className='px-5'>
            {!isFailed ? (
              <>
                {fileName && !loading ? (
                  <Box
                    my={4}
                    p={2}
                    sx={{
                      border: '1px solid gray',
                      borderRadius: '25px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <Typography>{fileName}</Typography>
                    </div>
                    <div>
                      <Button onClick={handleRemoveFile} disabled={loading} size='small'>
                        Remove
                      </Button>
                    </div>
                  </Box>
                ) : (
                  <>
                    {fileName && loading ? (
                      <div className='py-5'>
                        <DragAndDropComponent onDrop={onDrop} loading={loading} fileTypeName={fileTypeName} />
                      </div>
                    ) : (
                      <div className='py-5'>
                        <DragAndDropComponent onDrop={onDrop} fileTypeName={fileTypeName} />
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <Box my={4} p={2} sx={{ border: '1px solid gray', borderRadius: '20px' }}>
                  <Typography>{responseMessage}</Typography>
                </Box>
                <div className='flex justify-center gap-3 pb-4'>
                  <Button onClick={handleClose} color={'secondary'} disabled={loading} variant={'contained'}>
                    Cancel
                  </Button>
                  <Button variant='contained' onClick={handleUploadAgain}>
                    Upload Again
                  </Button>
                </div>
              </>
            )}
          </div>
          {fileName && !loading && (
            <div className='flex justify-center gap-3 pb-4'>
              <Button onClick={handleClose} color={'secondary'} disabled={loading} variant={'contained'}>
                Cancel
              </Button>
              <Button
                color={'primary'}
                startIcon={''}
                variant='contained'
                onClick={handleUploadFile}
                disabled={!file || loading}
              >
                {loading ? <Loader cover='normal' size={20} text='Uploading...' /> : 'Upload'}
              </Button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
