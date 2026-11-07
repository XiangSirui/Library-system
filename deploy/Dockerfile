FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Shanghai
WORKDIR /app
RUN useradd --uid 10001 --create-home app && mkdir /data /backups && chown app:app /data /backups
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
USER app
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "45", "--access-logfile", "-", "--access-logformat", "%(h)s %(m)s %(U)s %(s)s %(L)s", "--error-logfile", "-", "app:app"]
