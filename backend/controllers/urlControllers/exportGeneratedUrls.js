import ExcelJS from 'exceljs';
import UrlModel from '../../models/UrlModel.js';

export const exportGeneratedUrls = async (req, res) => {
  try {
    const urls = await UrlModel.find({ userId: req.user._id });

    if (!urls.length) {
      return res.status(404).json({ error: 'No Generated URL found' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SnapURL';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Generated_URLs Sheet');

    worksheet.columns = [
      { header: 'Short URL', key: 'shortUrl', width: 50 },
      { header: 'Original URL', key: 'originalUrl', width: 50 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Custom Back Half', key: 'customBackHalf', width: 20 },
      { header: 'Visits', key: 'visits', width: 10 },
    ];

    worksheet.getRow(1).font = { bold: true };

    urls.forEach((url) => {
      worksheet.addRow({
        shortUrl: `${process.env.SHORT_URL_PREFIX}/${url.shortUrl}`,
        originalUrl: url.originalUrl,
        category: url.category,
        customBackHalf: url.customBackHalf,
        visits: url.visitCount,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=Generated_URLs.xlsx',
    );
    res.status(200).send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
