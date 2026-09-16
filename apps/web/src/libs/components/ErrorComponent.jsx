'use client'

import React, { useState } from 'react'
import { Button, Card, CardContent, Typography, Grid, CircularProgress, CardHeader } from '@mui/material'
import { useRouter } from 'next/navigation'
import { toast } from 'react-toastify'

const ErrorComponent = ({
  errorMessage = 'Something went wrong.',
  onRefetch = null,
  refetching = false,
  showBackButton = true,
  showReloadButton = true,
  showRefetchButton = true,
  header = '',
  isShowHeader = true,
  color = 'error'
}) => {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Reload the current page
  const handleReload = () => {
    window.location.reload()
  }

  // Go back to the previous page
  const handleBack = () => {
    router.back()
  }

  // Refetch API data
  const handleRefetch = async () => {
    if (onRefetch && !loading) {
      setLoading(true)
      try {
        await onRefetch()
        toast.success('Data successfully refreshed!')
      } catch (err) {
        toast.error('Error while refreshing data')
      } finally {
        setLoading(false)
      }
    }
  }

  const getSafeErrorMessage = error => {
    if (!error) return 'An unknown error occurred.'

    if (error instanceof Error) {
      return error.message || 'An unknown error occurred.'
    }

    if (typeof error === 'object') {
      const message = error.message
      if (typeof message === 'string') {
        return message
      }
      if (typeof message === 'object') {
        try {
          return JSON.stringify(message)
        } catch {
          return 'An error occurred, but it could not be displayed.'
        }
      }
      try {
        return JSON.stringify(error)
      } catch {
        return 'An error occurred, but it could not be displayed.'
      }
    }
    if (typeof error === 'string') {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(error, 'text/html')
        const cleanText = doc.body.textContent || ''
        return cleanText.trim().length > 0 ? cleanText.trim() : 'An error occurred, but the response was not readable.'
      } catch {
        return error || 'An unknown error occurred.'
      }
    }
    return error || 'An unknown error occurred.'
  }
  return (
    <div className='h-full w-full flex flex-col items-center justify-center p-4'>
      <Card sx={{ width: '100%', maxWidth: 600, margin: 'auto', borderRadius: 2 }}>
        {!!header && (
          <div
            className={`block-start-5 sm:block-start-[33px] text-center pt-2 text-wrap inline-start-6 sm:inline-start-[38px] text-2xl font-semibold text-${color}`}
          >
            {header}
          </div>
        )}

        {!!isShowHeader && (
          <CardHeader
            title='Oops! Something didn’t go as planned.'
            subheader='Let’s give it another shot!'
            sx={{
              backgroundColor: 'primary', // Dark background color
              color: 'white', // White text color
              textAlign: 'center', // Center-align the title and subheader
              padding: '16px' // Padding for spacing inside the header
            }}
          />
        )}
        <CardContent>
          <Grid container spacing={2} justifyContent='center'>
            {/* Error Message Block */}
            <Grid item xs={12}>
              <Typography
                variant='h6'
                color={'error'}
                sx={{ wordWrap: 'break-word', whiteSpace: 'normal', textAlign: 'center' }}
                className='font-medium'
              >
                {getSafeErrorMessage(errorMessage)}
              </Typography>
            </Grid>

            {/* Refetch Button */}
            {!!showRefetchButton && (
              <Grid item>
                <Button
                  variant='contained'
                  color={color}
                  onClick={handleRefetch}
                  disabled={refetching || loading}
                  startIcon={loading ? <CircularProgress size={20} /> : <i className='tabler-refresh' />}
                  fullWidth
                >
                  {loading ? 'Refreshing...' : 'Refetch Data'}
                </Button>
              </Grid>
            )}

            {/* Reload Button */}
            {!!showReloadButton && (
              <Grid item>
                <Button
                  variant='tonal'
                  color={color}
                  onClick={handleReload}
                  startIcon={<i className='tabler-reload' />}
                  fullWidth
                >
                  Reload Page
                </Button>
              </Grid>
            )}

            {/* Back Button */}
            {!!showBackButton && (
              <Grid item>
                <Button
                  variant='outlined'
                  color={color}
                  onClick={handleBack}
                  startIcon={<i className='tabler-arrow-narrow-left' />}
                  fullWidth
                >
                  Go Back
                </Button>
              </Grid>
            )}
          </Grid>
        </CardContent>
      </Card>
    </div>
  )
}

export default ErrorComponent
