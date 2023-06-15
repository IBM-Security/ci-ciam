FROM node:18-alpine

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .
#RUN mv dotenv.publish .env && \
#    cat .env

CMD ["npm", "start"]
