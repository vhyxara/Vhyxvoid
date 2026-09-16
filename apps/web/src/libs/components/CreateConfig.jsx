import { Button, Card, CardContent, CardHeader, Grid } from '@mui/material'
import React from 'react'
import OpenDialogOnElementClick from '@/components/dialogs/OpenDialogOnElementClick'

export default function CreateConfig({
  dialogComponent,
  fetchDataCallback,
  headerText = 'No data found. Start by adding new data!',
  buttonText = 'Create Data',
  dialogProps = {}
}) {
  return (
    <Card className='flex items-center justify-center flex-col'>
      <CardHeader title={headerText} />
      <CardContent>
        <OpenDialogOnElementClick
          element={Button}
          dialog={dialogComponent}
          elementProps={{
            variant: 'contained',
            color: 'primary',
            children: buttonText
          }}
          dialogProps={{ fetchDataCallback, ...dialogProps }}
        />
      </CardContent>
    </Card>
  )
}
