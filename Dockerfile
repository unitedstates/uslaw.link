FROM node:10

WORKDIR /usr/src/app

# Install dependencies

COPY package*.json ./
RUN npm install

COPY citation/package*.json citation/
RUN cd citation && npm install

# Add source code (see .dockerignore, tho)

COPY environment.json .
COPY *.js ./
COPY public public
COPY citation citation
COPY legisworks-historical-statutes legisworks-historical-statutes

# Start.

EXPOSE 3000
CMD [ "node", "server.js" ]