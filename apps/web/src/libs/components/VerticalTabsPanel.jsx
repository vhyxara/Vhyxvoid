'use client'
// React Imports
import { useState } from 'react'

// MUI Imports
import Grid from '@mui/material/Grid'
import Tab from '@mui/material/Tab'
import TabContext from '@mui/lab/TabContext'
import TabPanel from '@mui/lab/TabPanel'
import CustomTabList from '@core/components/mui/TabList'

const VerticalTabsPanel = ({ tabContent, allTabs, defaultTab }) => {
  const tabs = allTabs.map(({ key, label, disabled = false }) => (
    <Tab
      key={key}
      value={key}
      disabled={disabled}
      label={<div className='flex items-center gap-1.5'>{label}</div>}
      className='flex items-start pl-0 justify-start'
    />
  ))

  const [activeTab, setActiveTab] = useState(defaultTab || allTabs[0].key)

  const handleChange = (event, newValue) => {
    setActiveTab(newValue)
  }
  return (
    <>
      <TabContext value={activeTab}>
        <div className='flex h-full w-full'>
          {/* <Grid item xs={12} className='flex justify-center'> */}
          <CustomTabList orientation='vertical' onChange={handleChange} variant='scrollable'>
            {tabs}
          </CustomTabList>
          {/* </Grid> */}
          {/* <Grid item xs={12}> */}
          <TabPanel value={activeTab} className='p-0 pl-4 h-full w-full'>
            {tabContent[activeTab] || <div className='w-full h-full text-center m-auto'>No Content Available</div>}
          </TabPanel>
          {/* </Grid> */}
        </div>
      </TabContext>
    </>
  )
}

export default VerticalTabsPanel
