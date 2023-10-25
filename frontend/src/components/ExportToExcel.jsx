import React, { useState } from 'react';
import { Button, Col, Container } from 'react-bootstrap';
import axios from 'axios';
import { saveAs } from 'file-saver';
import { toast } from 'react-toastify';

const ExportToExcel = () => {
  const [isLoading, setIsLoading] = useState(false);

  const handleExport = async () => {
    setIsLoading(true);
    toast.info('Exporting to Excel...');
    try {
      // Make a request to the backend to fetch the Excel file
      const URL = `${import.meta.env.VITE_API_ENDPOINT}/api/export`;
      const response = await axios.get(URL, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      // Save the Excel file using FileSaver.js
      saveAs(response.data, 'Generated_URLs.xlsx');
      toast.success('Exported to Excel');
      setIsLoading(false);
    } catch (error) {
      console.error(error);
      toast.error('Error exporting to Excel');
    }
  };

  return (
    <Container>
      <Col md={12} className={'text-center'}>
        <div className={'d-grid gap-2'}>
          <Button
            variant={'success'}
            disabled={isLoading}
            size={'lg'}
            onClick={handleExport}
          >
            {isLoading ? 'Exporting...' : 'Export to Excel'}
          </Button>
        </div>
      </Col>
    </Container>
  );
};

export default ExportToExcel;
