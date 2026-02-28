# Sinh Học 4.0 - Hướng dẫn triển khai

Ứng dụng trắc nghiệm sinh học nâng cao với phản hồi AI và hệ thống tích lũy điểm.

## 1. Triển khai lên Vercel

### Bước 1: Chuẩn bị mã nguồn
- Đảm bảo mã nguồn đã được đẩy lên GitHub.

### Bước 2: Cấu hình trên Vercel
1. Truy cập [Vercel Dashboard](https://vercel.com/dashboard).
2. Nhấn **Add New** -> **Project**.
3. Chọn repository chứa mã nguồn này.
4. Trong phần **Environment Variables**, thêm biến sau:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** (Mã API Key Gemini của bạn, lấy tại [Google AI Studio](https://aistudio.google.com/app/apikey))
5. Nhấn **Deploy**.

## 2. Cấu hình Google Sheet (Đồng bộ điểm)

Để đồng bộ điểm tích lũy, bạn cần tạo một Google Script (Web App) và dán URL vào phần **Cấu hình Sheet** trong ứng dụng.

### Mã Google Script (Tham khảo):

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  
  sheet.appendRow([
    new Date(),
    data.studentId,
    data.studentName,
    data.score,
    data.totalScore,
    data.aiFeedback
  ]);
  
  return ContentService.createTextOutput(JSON.stringify({"result": "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 3. Tác giả
- **Cô Kiều Thị Kim Thu** - THPT Dương Xá
