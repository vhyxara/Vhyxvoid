import React from 'react'
import { styled } from '@mui/material/styles'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'
import Box from '@mui/material/Box'

const EditorWrapper = styled(Box)(({ theme }) => ({
  '& .ql-editor': {
    minHeight: '10rem',
    color: theme.vars.palette.text.primary,
    padding: '1rem',
    borderColor: theme.vars.palette.divider,
    backgroundColor: theme.vars.palette.background.paper
  },
  '& .ql-toolbar': {
    borderColor: theme.vars.palette.divider,
    backgroundColor: theme.vars.palette.background.paper,
    '& .ql-picker': {
      color: theme.vars.palette.text.primary
    },
    '& .ql-stroke': {
      stroke: theme.vars.palette.text.primary
    },
    '& .ql-fill': {
      fill: theme.vars.palette.text.primary
    }
  },
  '& .ql-container': {
    borderColor: theme.vars.palette.divider
  }
}))

const RichTextEditor = ({ value, onChange, placeholder, plainTextMode = false }) => {
  const modules = plainTextMode
    ? { toolbar: false } // Hide toolbar when in plain text mode
    : {
        toolbar: [
          [{ header: [1, 2, false] }],
          ['bold', 'italic', 'underline'],
          ['link', 'image'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['clean']
        ]
      }

  const formats = plainTextMode ? [] : ['header', 'bold', 'italic', 'underline', 'link', 'image', 'list', 'bullet']

  return (
    <Card className='p-0 border shadow-none'>
      <CardContent className='p-0'>
        <EditorWrapper>
          <ReactQuill
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className='w-full h-80'
            modules={modules}
            formats={formats}
          />
        </EditorWrapper>
      </CardContent>
    </Card>
  )
}

export default RichTextEditor
