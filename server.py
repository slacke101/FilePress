from flask import Flask, request, jsonify, send_from_directory
from functools import wraps
import os
import datetime
import jwt
import bcrypt
import img2pdf
from werkzeug.utils import secure_filename
import PyPDF2

# --------------------- CONFIGURATION ---------------------
app = Flask(__name__, static_folder="client/dist", static_url_path="/")
app.config["SECRET_KEY"] = "CHANGE_ME_SECRET_KEY"

UPLOAD_FOLDER = "uploads"
CONVERTED_FOLDER = os.path.join(UPLOAD_FOLDER, "converted")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CONVERTED_FOLDER, exist_ok=True)

# --------------------- SIMPLE IN-MEMORY “DB” ---------------------
# This keeps things easy to run without installing MongoDB.
# NOTE: Data resets every time the server restarts.

hashed_admin_pw = bcrypt.hashpw("password".encode(), bcrypt.gensalt())
USERS = {"admin": hashed_admin_pw}
FILES = []  # each item: {filename, size, mimetype, owner}

# --------------------- AUTH DECORATOR ---------------------


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if "Authorization" in request.headers:
            parts = request.headers["Authorization"].split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                token = parts[1]
        if not token:
            return jsonify({"error": "Token missing"}), 401
        try:
            data = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
            # very small “lookup” – we only store username in USERS dict
            if data["username"] not in USERS:
                raise ValueError("user not found")
            current_user = {"username": data["username"]}
        except Exception as e:
            return jsonify({"error": "Token invalid", "detail": str(e)}), 401
        request.current_user = current_user
        return f(*args, **kwargs)

    return decorated


# --------------------- STATIC PAGES ---------------------


@app.route("/")
def root():
    return app.send_static_file("index.html")


# Preserve old login page for now under /login if needed


@app.route("/login")
def legacy_login():
    return send_from_directory(".", "login.html")


# React handles routing; keep for compatibility
@app.route("/dashboard")
def dashboard():
    return app.send_static_file("index.html")


# Old JSX no longer needed after build, but keep serving for dev fallback
@app.route("/dashboard.jsx")
def dashboard_jsx():
    return send_from_directory(".", "dashboard.jsx")


# --------------------- AUTH & LOGIN ENDPOINT ---------------------


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "Missing credentials"}), 400

    stored_pw = USERS.get(data["username"])
    if not stored_pw or not bcrypt.checkpw(data["password"].encode(), stored_pw):
        return jsonify({"error": "Invalid credentials"}), 401

    token = jwt.encode(
        {
            "username": data["username"],
            "exp": datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(hours=2),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )
    return jsonify({"token": token})


# --------------------- FILE UPLOAD ---------------------


@app.route("/upload", methods=["POST"])
@login_required
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    meta = {
        "username": request.current_user["username"],
        "filename": filename,
        "size": os.path.getsize(filepath),
        "mimetype": file.mimetype,
    }

    # If PDF, extract number of pages
    if filename.lower().endswith(".pdf"):
        try:
            with open(filepath, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                meta["pages"] = len(reader.pages)
                doc_info = reader.metadata or {}
                simple_info = {
                    k[1:]: v
                    for k, v in doc_info.items()
                    if k in ("/Title", "/Author", "/Creator")
                }
                if simple_info:
                    meta["docinfo"] = simple_info
        except Exception:
            meta["pages"] = None

    FILES.append(meta)

    return jsonify({"filename": filename, **meta})


# --------------------- DELETE FILE ---------------------


@app.route("/files/<filename>", methods=["DELETE"])
@login_required
def delete_file_endpoint(filename):
    # Only allow deletion of user's own file
    record = next(
        (
            f
            for f in FILES
            if f["filename"] == filename
            and f["username"] == request.current_user["username"]
        ),
        None,
    )
    if not record:
        return jsonify({"error": "File not found"}), 404

    # Remove from in-memory list
    FILES.remove(record)

    # Delete from disk (uploads and converted)
    for folder in [UPLOAD_FOLDER, CONVERTED_FOLDER]:
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            os.remove(path)

    return jsonify({"status": "deleted"})


# --------------------- FILE CONVERSION ---------------------


@app.route("/convert/<filename>", methods=["POST"])
@login_required
def convert_file(filename):
    src_path = os.path.join(UPLOAD_FOLDER, filename)
    if not os.path.exists(src_path):
        return jsonify({"error": "File not found"}), 404

    name, ext = os.path.splitext(filename)
    if ext.lower() == ".pdf":
        return jsonify(
            {"message": "Already PDF", "download_url": f"/download/{filename}"}
        )

    if ext.lower() not in [".png", ".jpg", ".jpeg"]:
        return jsonify({"error": "Only PNG/JPG files can be converted"}), 400

    dst_filename = f"{name}.pdf"
    dst_path = os.path.join(CONVERTED_FOLDER, dst_filename)

    try:
        with open(src_path, "rb") as img_file, open(dst_path, "wb") as pdf_file:
            pdf_file.write(img2pdf.convert(img_file))
    except Exception as e:
        return jsonify({"error": "Conversion failed", "detail": str(e)}), 500

    return jsonify({"download_url": f"/download/{dst_filename}"})


# --------------------- DOWNLOAD ENDPOINT ---------------------


@app.route("/download/<path:filename>")
@login_required
def download_file(filename):
    # Look in converted folder first, then uploads
    for folder in [CONVERTED_FOLDER, UPLOAD_FOLDER]:
        file_path = os.path.join(folder, filename)
        if os.path.exists(file_path):
            return send_from_directory(folder, filename, as_attachment=True)
    return jsonify({"error": "File not found"}), 404


# --------------------- FILE LIST ---------------------


@app.route("/files", methods=["GET"])
@login_required
def list_files():
    user_files = [f for f in FILES if f["username"] == request.current_user["username"]]
    return jsonify(user_files)


# --------------------- PDF EXTRACTION ---------------------


@app.route("/parse/<filename>", methods=["GET"])
@login_required
def parse_pdf(filename):
    src_path = os.path.join(UPLOAD_FOLDER, filename)
    if not os.path.exists(src_path):
        return jsonify({"error": "File not found"}), 404

    if not filename.lower().endswith(".pdf"):
        return jsonify({"error": "Not a PDF"}), 400

    text = ""
    try:
        with open(src_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() or ""
                if len(text) > 5000:
                    text += "\n... (truncated)"
                    break
    except Exception as e:
        return jsonify({"error": "Parse failed", "detail": str(e)}), 500

    return jsonify({"text": text})


if __name__ == "__main__":
    app.run(debug=True)
