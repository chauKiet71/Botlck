# Kết nối trực tiếp NotebookLM

## Tự chọn notebook trong toàn bộ tài khoản

Đặt `NOTEBOOKLM_NOTEBOOK_ID=all` để bật chế độ nhiều notebook. Bot gọi `assistant_list_notebooklm` lấy danh mục mới cho mỗi câu hỏi kiến thức, dùng mô hình đang chạy để chọn notebook theo ý nghĩa câu hỏi và tiêu đề, rồi gọi `assistant_ask_notebooklm` với `notebookId` đã chọn. Công cụ xác minh ID vẫn nằm trong danh mục tài khoản trước khi truy vấn. Notebook mới tự xuất hiện trong lần lấy danh mục tiếp theo, không cần sửa danh sách 34 ID.

Nếu câu hỏi liên quan nhiều chủ đề hoặc thiếu bằng chứng, bot được hướng dẫn thử các notebook phù hợp khác, thường tối đa 3 notebook cho một câu hỏi, rồi tổng hợp với tên/link notebook và trích dẫn riêng. Đây là chọn lọc theo chủ đề, không phải tìm kiếm toàn văn đồng thời cả 34 notebook. Tiêu đề không rõ hoặc chưa đặt tên có thể làm lựa chọn kém chính xác; nên đặt tên notebook mô tả nội dung. Không được nói đã tìm hết kho nếu chỉ kiểm tra một phần. Có thể giữ chế độ một notebook bằng cách thay `all` bằng UUID đầy đủ; công cụ không cho AI vượt phạm vi này.

Bot có công cụ `assistant_ask_notebooklm`. Khi đã cấu hình, prompt runtime yêu cầu bot tra cứu NotebookLM trước các câu hỏi kiến thức. Công cụ hỏi trực tiếp notebook, lấy toàn bộ nguồn hiện tại mỗi lần, trả câu trả lời và trích dẫn; không sao chép tài liệu vào Neon và không cache kết quả. Nguồn mới dùng được sau khi NotebookLM xử lý xong. Việc sửa file gốc trên Drive vẫn phụ thuộc cơ chế cập nhật nguồn của NotebookLM.

Dùng thư viện cộng đồng `notebooklm-py==0.8.5` (không phải API chính thức của Google). Phiên đăng nhập có thể hết hạn; thay đổi API nội bộ có thể yêu cầu nâng thư viện. Câu hỏi có thể nối vào lịch sử chat hiện tại của notebook. Tích hợp không xóa lịch sử. Dùng cho một chủ sở hữu; không dùng chung tài khoản/notebook giữa các khách hàng độc lập.

## 1. Đăng nhập Google trên Windows

Mở PowerShell ở thư mục dự án. Môi trường `.venv-notebooklm` đã được tạo trên máy hiện tại. Trên máy mới, chạy hai lệnh cài đặt đầu tiên:

```powershell
python -m venv .venv-notebooklm
.\.venv-notebooklm\Scripts\python.exe -m pip install 'notebooklm-py[browser]==0.8.5'
$env:NOTEBOOKLM_STORAGE_PATH = "$env:USERPROFILE\.notebooklm\profiles\default\storage_state.json"
New-Item -ItemType Directory -Force (Split-Path $env:NOTEBOOKLM_STORAGE_PATH) | Out-Null
.\.venv-notebooklm\Scripts\notebooklm.exe --storage $env:NOTEBOOKLM_STORAGE_PATH login --browser msedge
```

Đăng nhập bằng tài khoản có quyền mở notebook trong cửa sổ Edge vừa mở. CLI lưu phiên sau khi phát hiện đăng nhập thành công. Nếu máy không có Edge, thay `msedge` bằng `chrome` (cần Chrome đã cài).

Luôn dùng đường dẫn thực tế CLI thông báo tại `Authentication saved to`. Phiên đã đăng nhập trên máy này được lưu ở `C:\Users\DELL\.notebooklm\profiles\default\storage_state.json`; bản CLI này có thể lưu theo profile dù login có tham số `--storage`.

Kiểm tra và xem notebook:

```powershell
.\.venv-notebooklm\Scripts\notebooklm.exe --storage $env:NOTEBOOKLM_STORAGE_PATH auth check --test
.\.venv-notebooklm\Scripts\notebooklm.exe --storage $env:NOTEBOOKLM_STORAGE_PATH list
```

Lấy UUID đầy đủ từ link `https://notebooklm.google.com/notebook/UUID`. Không dùng tên notebook hoặc ID rút gọn.

## 2. Cấu hình bot chạy trên Windows

Thêm vào file môi trường riêng của Gateway `C:\Users\DELL\.openclaw\.env` (không phải file trong Git):

```dotenv
NOTEBOOKLM_NOTEBOOK_ID=all
NOTEBOOKLM_OWNER_KEY=channel:telegram:requester:TELEGRAM_USER_ID
NOTEBOOKLM_CLI=D:/Code/Bot_agent_LCK/.venv-notebooklm/Scripts/notebooklm.exe
NOTEBOOKLM_STORAGE_PATH=C:/Users/DELL/.notebooklm/profiles/default/storage_state.json
NOTEBOOKLM_TIMEOUT_MS=120000
```

Thay `TELEGRAM_USER_ID` bằng ID số của chính người dùng được phép hỏi bot, không phải username hoặc token bot. Có thể lấy ID từ phần thông tin người gửi/pairing của OpenClaw. Quyền được kiểm tra từ `messageChannel` và `requesterSenderId` do runtime cung cấp, không từ tham số mà AI tự đặt. Mặc định thiếu quyền là từ chối. Chỉ dùng trong chat riêng; không bật bot đọc kho riêng tư trong nhóm. Các kênh khác cần thay `telegram` bằng channel ID thực tế.

```powershell
npm run build
openclaw gateway restart
```

Nếu cấu hình công cụ dùng allowlist riêng, thêm `assistant_list_notebooklm` và `assistant_ask_notebooklm` vào danh sách cho phép. Không cần sửa cấu hình Neon.

## 3. Nếu bot chạy trên Railway

Deploy phiên bản code này: Dockerfile cài sẵn CLI vào `/opt/notebooklm/bin/notebooklm`. Không chạy đăng nhập trình duyệt trong container.

Startup tự thêm hai công cụ NotebookLM vào `tools.alsoAllow` khi đã cấu hình notebook, giữ các mục đang có. Điều này cần thiết với profile `coding`, vốn không tự bật công cụ plugin. Các deny rule riêng vẫn được giữ nguyên.

Trong Railway Variables, đặt:

```dotenv
NOTEBOOKLM_NOTEBOOK_ID=all
NOTEBOOKLM_OWNER_KEY=channel:telegram:requester:TELEGRAM_USER_ID
NOTEBOOKLM_AUTH_JSON=<toan-bo-noi-dung-file-storage_state.json>
NOTEBOOKLM_TIMEOUT_MS=120000
```

`NOTEBOOKLM_AUTH_JSON` là secret: dùng chức năng sealed variable nếu có. Để copy nội dung mà không in ra terminal:

```powershell
Get-Content -Raw "$env:USERPROFILE\.notebooklm\profiles\default\storage_state.json" | Set-Clipboard
```

Dán trực tiếp vào Railway Variables rồi xóa clipboard. Không gửi nội dung này vào chat, không commit vào Git. Không đặt `NOTEBOOKLM_STORAGE_PATH` cho cách dùng AUTH_JSON vì đường dẫn Windows không tồn tại trong container. Docker đã đặt `NOTEBOOKLM_HOME=/data/.notebooklm`; giữ volume `/data` hiện có. Redeploy sau khi cập nhật biến.

Khi phiên hết hạn, đăng nhập lại trên Windows rồi thay secret Railway và redeploy. Trên máy Windows dùng file phiên, chỉ cần đăng nhập lại vào đúng đường dẫn file. Không tự động thử lại câu hỏi lỗi để tránh gửi trùng/lặp hạn mức.

## 4. Kiểm tra sau cấu hình

1. Hỏi bot trong chat riêng một câu có đáp án rõ trong notebook. Kiểm tra bot gọi `assistant_ask_notebooklm`, câu trả lời có nguồn phù hợp.
2. Thêm một tài liệu mới với chi tiết dễ nhận biết. Đợi NotebookLM xử lý xong rồi hỏi về chi tiết đó. Không cần restart bot hoặc nhập lại kho tri thức.
3. Hỏi nội dung ngoài tài liệu: bot phải nói thiếu bằng chứng; nếu bổ sung kiến thức chung phải phân biệt rõ.
4. Với người gửi khác, công cụ phải từ chối. Nếu lỗi đăng nhập/quyền/mạng/timeout, bot phải báo tra cứu chưa thành công thay vì khẳng định notebook không có thông tin.

Tests tự động dùng tiến trình giả lập để kiểm tra giao thức, danh mục động, phạm vi notebook, quyền, timeout, hủy, trích dẫn và lọc lỗi. Kiểm tra thật cần phiên Google hợp lệ; kiểm tra CLI thành công chưa thay thế việc kiểm tra bot sau deploy.

Tài liệu thư viện: https://github.com/teng-lin/notebooklm-py/tree/v0.8.5
