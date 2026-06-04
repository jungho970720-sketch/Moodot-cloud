# AWS Cost Operations

Moodot을 사용하지 않을 때 비용을 줄이기 위한 RDS/EC2 운영 절차입니다.

## 현재 비용 절감 상태

- ALB `ecs-express-gateway-alb-ea0b2ea4` 삭제 완료
- ALB 대상 그룹 `ecs-gateway-tg-*` 삭제 완료
- Elastic IP는 Moodot용 `15.164.114.242` 1개만 유지
- EC2 `i-0dede142831921e17`는 필요할 때만 시작
- RDS `database-1`는 필요할 때만 시작

## 안 쓸 때 끄기

### 1. EC2 중지

로컬 맥 터미널:

```bash
aws ec2 stop-instances \
  --region ap-northeast-2 \
  --instance-ids i-0dede142831921e17
```

상태 확인:

```bash
aws ec2 describe-instances \
  --region ap-northeast-2 \
  --instance-ids i-0dede142831921e17 \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text
```

`stopped`가 나오면 중지 완료입니다.

### 2. RDS 중지

로컬 맥 터미널:

```bash
aws rds stop-db-instance \
  --region ap-northeast-2 \
  --db-instance-identifier database-1
```

상태 확인:

```bash
aws rds describe-db-instances \
  --region ap-northeast-2 \
  --db-instance-identifier database-1 \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text
```

`stopped`가 나오면 중지 완료입니다.

주의:

- RDS를 중지하면 기록 저장/조회, 컬렉션, AI Worker DB 작업은 동작하지 않습니다.
- RDS는 최대 7일까지만 중지 상태를 유지할 수 있고, 이후 AWS가 자동으로 다시 시작할 수 있습니다.
- 데이터는 삭제되지 않습니다.

## 다시 쓸 때 켜기

### 1. RDS 시작

로컬 맥 터미널:

```bash
aws rds start-db-instance \
  --region ap-northeast-2 \
  --db-instance-identifier database-1
```

상태 확인:

```bash
aws rds describe-db-instances \
  --region ap-northeast-2 \
  --db-instance-identifier database-1 \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text
```

`available`이 나올 때까지 기다립니다.

### 2. EC2 시작

로컬 맥 터미널:

```bash
aws ec2 start-instances \
  --region ap-northeast-2 \
  --instance-ids i-0dede142831921e17
```

상태 확인:

```bash
aws ec2 describe-instances \
  --region ap-northeast-2 \
  --instance-ids i-0dede142831921e17 \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text
```

`running`이 나오면 시작 완료입니다.

### 3. 사이트 확인

로컬 맥 터미널:

```bash
curl -sS --max-time 10 https://mood-ot.com/health
curl -sS --max-time 10 https://mood-ot.com/health/db
```

기대 결과:

```json
{"ok":true}
```

```json
{"ok":true,"db":"postgres"}
```

### 4. PM2 확인

EC2 터미널:

```bash
pm2 list
sudo systemctl status pm2-ubuntu
```

정상 기준:

- `moodot-fe` online
- `moodot-be` online
- `moodot-ai-worker` online
- `pm2-ubuntu.service` active

PM2 프로세스가 없을 때만 다시 시작합니다.

EC2 터미널:

```bash
cd ~/Moodot-cloud
pm2 start npm --name moodot-fe -- start

cd ~/Moodot-cloud/backend
pm2 start npm --name moodot-be -- start

cd ~/Moodot-cloud/service
pm2 start python3 --name moodot-ai-worker -- main.py

pm2 save
pm2 list
```

## 삭제하면 안 되는 것

- Elastic IP `15.164.114.242`
- Route 53 `mood-ot.com` 레코드
- RDS `database-1` 데이터베이스
- S3 버킷 `moodot-memory-images-junho-2026`
- EC2 IAM Role `MoodotEc2S3Role`

## 정리 후보

- ECS 서비스 `moodot-ai-worker-ae0c`
  - 확인 당시 `Desired=0`, `Running=0`, `LoadBalancers=None`
  - 비용 영향은 거의 없지만, 예전 실습 흔적으로 보이면 삭제 가능
