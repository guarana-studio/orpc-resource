import "@knadh/oat/oat.min.css";
import "@knadh/oat/oat.min.js";
import "./app.css";
import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { render } from "preact";

import type { Router } from "./server";

const root = document.getElementById("app")!;

const link = new RPCLink({
  url: "http://localhost:3000/rpc",
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const client: RouterClient<Router> = createORPCClient(link);

const notes = await client.notes.list({});

function App() {
  async function handleCreate(event: SubmitEvent) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    await client.notes.create(data);
    window.location.reload();
  }
  async function handleUpdate(event: SubmitEvent) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const data = Object.fromEntries(formData.entries());
    const { id, ...updateData } = data;
    await client.notes.update({ id, data: updateData });
    window.location.reload();
  }
  async function handleDelete(id: string) {
    await client.notes.deleteOne(id);
    window.location.reload();
  }
  return (
    <div class="container">
      <form onSubmit={handleCreate}>
        <label data-field>
          Title
          <input type="text" placeholder="Enter your name" name="title" />
        </label>
        <label data-field>
          Content
          <textarea placeholder="Your message..." name="content"></textarea>
        </label>
        <button type="submit">Add Note</button>
      </form>
      <hr />
      <div class="flex flex-col gap-2">
        {notes.results.map((note) => (
          <form class="card" onSubmit={handleUpdate}>
            <input type="hidden" name="id" value={note.id} />
            <label data-field>
              Title
              <input type="text" defaultValue={note.title} name="title" />
            </label>
            <label data-field>
              Content
              <textarea defaultValue={note.content} name="content" />
            </label>
            <footer class="flex gap-2">
              <button type="submit">Save</button>
              <button type="button" class="outline" onClick={() => handleDelete(note.id)}>
                Delete
              </button>
            </footer>
          </form>
        ))}
      </div>
    </div>
  );
}

render(<App />, root);
