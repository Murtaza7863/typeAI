### **Table of Contents**

- [Forking typeAI](#forking-typeai)
- [Creating Quotes](#creating-quotes)
- [Committing Quotes](#committing-quotes)
- [Quote Guidelines](#quote-guidelines)

### Forking typeAI

First you will have to copy the typeAI repository also known as forking. Go to the [typeAI Repo](https://github.com/Murtaza7863/monkeytype-typing-coach/) and then click the "fork" button.

<img width="1552" alt="Screen Shot 2022-01-12 at 11 51 49 AM" src="https://user-images.githubusercontent.com/83455454/149194972-23343642-7a1f-4c0c-b5f2-36f4b39a2639.png">

## Creating Quotes

After you forked the typeAI repository you can now add your quotes. (If you haven't already forked the repository, refer to this [section](#forking-typeai).) (Before continuing to the next step make sure the quote's language exists in typeAI) Add this code in at the end of the quotes `./frontend/static/quotes/[language].json`:

```json
{
    "text": "[quote]",
    "source": "[source]",
    "id": [number of the quote],
    "length": [number of characters in quote]
}
```

If the language does exist in typeAI, but there are no quotes for it create a new file for the language.

### Committing Quotes

Once you have added your quote(s), you now need to create a pull request to the main typeAI repository. Go to the branch where you added your quotes on GitHub. Then make sure your branch is up to date. Once it is up to date, click "contribute".

Update branch:
<img width="1552" alt="Screenshot showing how to update the fork to match the main typeAI repository" src="https://user-images.githubusercontent.com/83455454/149186547-5b9fe4fd-b944-4eed-a959-db43f96198bf.png">

Create a pull request:
<img width="1552" alt="Screenshot showing how to create a pull request to the main typeAI repository" src="https://user-images.githubusercontent.com/83455454/149186637-66dae488-05ae-45c4-9217-65bc36c4927b.png">

## Quote Guidelines

Make sure your quote(s) follows the [Quote guidelines](./CONTRIBUTING.md#quote-guidelines).
