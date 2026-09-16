import React from 'react'
import { useDropzone, DropzoneOptions, FileWithPath } from 'react-dropzone'
import AppReactDropzone from '@/libs/styles/AppReactDropzone'
import { Button } from '@mui/material'

// Defining the props interface for the Dropzone component
interface DropzoneProps {
  onDrop: (acceptedFiles: File[]) => void
}

const Dropzone: React.FC<DropzoneProps> = ({ onDrop }) => {
  // Specifying the types for useDropzone
  const { getRootProps, getInputProps, acceptedFiles, isDragActive, open } = useDropzone({
    multiple: false,
    onDrop
  } as DropzoneOptions)

  // Mapping accepted files
  const files = acceptedFiles.map((file: FileWithPath) => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ))

  return (
    <AppReactDropzone>
      <div {...getRootProps({ className: 'dropzone' })}>
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
      </div>
      {/* <aside>
        <ul>{files}</ul>
      </aside> */}
    </AppReactDropzone>
  )
}

export default Dropzone
